import asyncio
import os
import re
import time as _time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import require_roles
from app.database import get_db
from app.models import (
    ClassroomCredential,
    ClassroomGroupBinding,
    User,
)
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.classroom import state as classroom_state
from app.services.classroom import sync as classroom_sync
from app.services.classroom import tokens as classroom_tokens
from app.services.classroom import worker as classroom_worker
from app.services.classroom.parser import URL_RE
from app.services.classroom.state import (
    _SYNC_LOCK_GROUPS,
    _iso_utc,
    _latest_unmapped_tasks,
    _read_classroom_heartbeat,
    _sync_backoff_state,
)
from app.services.classroom.tokens import decrypt_token_detailed

router = APIRouter()


@router.post("/clear-all-data")
async def clear_all_classroom_data(
    group_id: Optional[int] = None,
    wipe_secret: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Очищає всі Classroom-прив'язки (classroom_group_bindings та classroom_credentials)
    та автоматичні нотатки/посилання/ДЗ.
    Ручні текстові нотатки студентів та викладачів залишаються недоторканими.
    """
    if not settings.wipe_secret or wipe_secret != settings.wipe_secret:
        raise HTTPException(status_code=403, detail="Невірний секрет очищення")

    # 1. Видаляємо зв'язки
    binding_stmt = delete(ClassroomGroupBinding)
    cred_stmt = delete(ClassroomCredential)
    if group_id:
        binding_stmt = binding_stmt.where(ClassroomGroupBinding.group_id == group_id)
        cred_stmt = cred_stmt.where(ClassroomCredential.group_id == group_id)
    binding_res = await db.execute(binding_stmt)
    await db.execute(cred_stmt)
    deleted_bindings = binding_res.rowcount or 0

    # 2. Очищаємо всі автоматичні нотатки [TASK], посилання Meet/Zoom
    notes_query = select(LessonOccurrenceNote).where(LessonOccurrenceNote.archived.is_(False))
    if group_id:
        notes_query = notes_query.where(LessonOccurrenceNote.group_id == group_id)
    notes = (await db.scalars(notes_query)).all()

    cleaned_notes_count = 0
    archived_notes_count = 0

    for gn in notes:
        manual_lines = [
            line.strip()
            for line in gn.note.split("\n")
            if line.strip()
            and not line.strip().startswith("[TASK]")
            and not URL_RE.search(line)
            and not re.search(r"(?:Код|ID|Passcode|Пароль)\s*:", line, re.IGNORECASE)
        ]
        if manual_lines:
            new_text = "\n".join(manual_lines)
            if gn.note != new_text:
                gn.note = new_text
                gn.revision += 1
                gn.updated_at = datetime.now(timezone.utc)
                cleaned_notes_count += 1
        else:
            gn.archived = True
            gn.revision += 1
            gn.updated_at = datetime.now(timezone.utc)
            archived_notes_count += 1

    await db.commit()
    return {
        "status": "success",
        "deleted_bindings": deleted_bindings,
        "cleaned_notes": cleaned_notes_count,
        "archived_auto_notes": archived_notes_count,
    }


@router.get("/status")
async def get_classroom_status():
    return {
        "has_client_secret": bool(classroom_tokens.get_google_client_secret()),
        "client_id": classroom_tokens.get_google_client_id(),
    }


@router.get("/groups/{group_id}/status")
async def get_classroom_group_status(
    group_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    from app.services.classroom_access import check_classroom_group_access
    has_access = await check_classroom_group_access(db, group_id, request)

    binding = await db.scalar(
        select(ClassroomGroupBinding).where(
            ClassroomGroupBinding.group_id == group_id,
            ClassroomGroupBinding.is_active.is_(True),
        )
    )
    accounts_summary = await classroom_sync._build_group_accounts_summary(db, group_id)
    has_active_creds = accounts_summary["connected_accounts_count"] > 0

    tasks = classroom_state._latest_group_tasks.get(group_id)
    if tasks is None and (binding or has_active_creds):
        tasks = await classroom_sync.reconstruct_tasks_from_notes(db, group_id, binding)

        # 2.2: Після перезапуску сервера автоматично запускаємо позачергову фонову синхронізацію групи,
        # щоб оперативно підтягнути повний масив завдань і метаданих із Google Classroom
        if group_id not in _SYNC_LOCK_GROUPS:
            try:
                asyncio.create_task(classroom_worker.run_background_sync_task(group_id, force=True))
            except RuntimeError:
                pass

    last_synced = (
        accounts_summary["latest_cred_synced_at"]
        or (_iso_utc(binding.last_synced_at) if (binding and binding.last_synced_at) else None)
    )

    return {
        "connected": bool(binding) or has_active_creds,
        "last_synced_at": last_synced,
        "has_refresh_token": bool(binding and binding.refresh_token) or has_active_creds,
        "has_client_secret": bool(classroom_tokens.get_google_client_secret()),
        "sync_in_progress": group_id in _SYNC_LOCK_GROUPS,
        "unmapped_tasks": _latest_unmapped_tasks.get(group_id, []) if has_access else [],
        "tasks": (tasks if tasks is not None else []) if has_access else [],
        "requires_auth": not has_access,
        **accounts_summary,
    }


@router.get("/credentials/diagnostics")
async def get_classroom_credentials_diagnostics(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
):
    """Детальна діагностика стану токенів шифрування (доступна лише адміністраторам)."""
    creds = (
        await db.scalars(
            select(ClassroomCredential).order_by(
                ClassroomCredential.group_id.asc(), ClassroomCredential.id.asc()
            )
        )
    ).all()
    results = []
    for c in creds:
        plain, status = decrypt_token_detailed(c.refresh_token)
        has_plain = bool(plain)
        prefix = plain[:4] if plain else None
        results.append({
            "id": c.id,
            "group_id": c.group_id,
            "google_user_id": c.google_user_id,
            "email": c.email,
            "student_name": c.student_name,
            "subgroup": c.subgroup,
            "is_active": c.is_active,
            "needs_relink": getattr(c, "needs_relink", False),
            "fail_count": c.fail_count,
            "last_error": c.last_error,
            "next_attempt_at": _iso_utc(c.next_attempt_at),
            "last_synced_at": c.last_synced_at.isoformat() if c.last_synced_at else None,
            "last_refresh_ok_at": c.last_refresh_ok_at.isoformat() if getattr(c, "last_refresh_ok_at", None) else None,
            "last_client_seen_at": c.last_client_seen_at.isoformat() if getattr(c, "last_client_seen_at", None) else None,
            "granted_scopes": getattr(c, "granted_scopes", None),
            "token_status": status,
            "token_format_valid": has_plain and not (plain or "").startswith("ya29."),
            "token_prefix": prefix,
        })
    now_utc = datetime.now(timezone.utc)
    now_mono = _time.monotonic()
    group_backoffs = {}
    for gid, (fails, next_allowed) in _sync_backoff_state.items():
        rem = next_allowed - now_mono
        if rem > 0:
            group_backoffs[str(gid)] = {
                "failures": fails,
                "backoff_until": _iso_utc(now_utc + timedelta(seconds=rem)),
                "remaining_seconds": int(rem),
            }
    primary_key_configured = bool(os.getenv("CLASSROOM_FERNET_KEY") or getattr(settings, "classroom_fernet_key", ""))
    worker_heartbeat = await _read_classroom_heartbeat(db)
    return {
        "primary_key_configured": primary_key_configured,
        "total_credentials": len(results),
        "worker_heartbeat": worker_heartbeat,
        "group_backoffs": group_backoffs,
        "credentials": results,
    }
