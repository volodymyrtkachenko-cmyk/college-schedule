import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_roles
from app.database import get_db
from app.models import (
    ClassroomCredential,
    ClassroomGroupBinding,
    Group,
    GroupStudent,
    User,
)
from app.schemas.classroom import BulkStudentsPayload
from app.services.classroom import sync as classroom_sync
from app.services.classroom import worker as classroom_worker
from app.services.classroom.parser import IGNORE_ROSTER_LINES, _norm, ukr_sort_key
from app.services.classroom.state import MAX_ACCOUNTS_PER_CYCLE, _iso_utc

router = APIRouter()


@router.delete("/credentials/{cred_id}")
async def delete_classroom_credential(
    cred_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    """Видаляє підключений акаунт групи (ClassroomCredential)."""
    cred = await db.get(ClassroomCredential, cred_id)
    if not cred:
        raise HTTPException(status_code=404, detail="Підключений акаунт не знайдено")
    group_id = cred.group_id
    await db.delete(cred)
    await db.commit()
    summary = await classroom_sync._build_group_accounts_summary(db, group_id)
    return {"ok": True, "message": "Акаунт успішно відключено", **summary}


@router.get("/groups/{group_id}/students")
async def get_group_students(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    students = (
        await db.scalars(
            select(GroupStudent).where(GroupStudent.group_id == group_id)
        )
    ).all()
    students = sorted(students, key=lambda s: ukr_sort_key(s.full_name))
    binding = await db.scalar(
        select(ClassroomGroupBinding).where(ClassroomGroupBinding.group_id == group_id)
    )
    accounts_summary = await classroom_sync._build_group_accounts_summary(db, group_id)
    last_synced = (
        accounts_summary["latest_cred_synced_at"]
        or (_iso_utc(binding.last_synced_at) if (binding and binding.last_synced_at) else None)
    )
    return {
        "course_name": binding.course_name if binding else None,
        "last_synced_at": last_synced,
        **accounts_summary,
        "students": [
            {
                "id": s.id,
                "full_name": s.full_name,
                "email": s.email,
                "photo_url": s.photo_url,
            }
            for s in students
        ],
    }


@router.post("/groups/{group_id}/sync-now")
async def sync_group_classroom_now(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    """Примусово запускає синхронізацію Classroom для конкретної групи з адмін-панелі."""
    group = await db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Групу не знайдено")
    await classroom_worker.trigger_background_sync_if_needed(
        db,
        group_id,
        max_accounts=max(10, MAX_ACCOUNTS_PER_CYCLE),
        force=True,
    )
    roster = await get_group_students(group_id=group_id, db=db, _=_)
    return {"ok": True, **roster}


@router.post("/groups/{group_id}/students/bulk")
async def bulk_import_group_students(
    group_id: int,
    payload: BulkStudentsPayload,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    group = await db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Групу не знайдено")

    if payload.replace_existing:
        await db.execute(delete(GroupStudent).where(GroupStudent.group_id == group_id))
        await db.flush()

    existing = (
        await db.scalars(select(GroupStudent).where(GroupStudent.group_id == group_id))
    ).all()
    existing_names = {_norm(s.full_name) for s in existing}

    added = 0
    for raw_line in payload.raw_text.splitlines():
        line = re.sub(r"^\s*\d+[\.\)\-]\s*", "", raw_line).strip()
        if not line or len(line) < 4:
            continue
        line_norm = _norm(line)
        if line_norm in IGNORE_ROSTER_LINES:
            continue
        if re.match(r"^\d+\s+(учащ|студент|здобувач|people|students)", line_norm):
            continue

        email_match = re.search(r"[\w.\-+]+@[\w.\-]+\.\w+", line)
        email = email_match.group(0) if email_match else None
        if email:
            line = line.replace(email, "").strip(" -|,;()\t")

        words = [w for w in line.split() if len(w) >= 2]
        if len(words) < 2 or len(words) > 4:
            continue

        clean_name = " ".join(words)[:150]
        norm_name = _norm(clean_name)
        if norm_name in existing_names:
            continue

        db.add(
            GroupStudent(
                group_id=group_id,
                classroom_user_id=f"manual_{group_id}_{abs(hash(norm_name)) % 10**8}",
                full_name=clean_name,
                email=email[:150] if email else None,
                photo_url=None,
            )
        )
        existing_names.add(norm_name)
        added += 1

    await db.commit()
    total_count = await db.scalar(
        select(func.count(GroupStudent.id)).where(GroupStudent.group_id == group_id)
    )
    return {"added": added, "total": total_count or len(existing_names)}


@router.delete("/groups/{group_id}/students/{student_id}")
async def remove_group_student(
    group_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    st = await db.scalar(
        select(GroupStudent).where(
            GroupStudent.id == student_id,
            GroupStudent.group_id == group_id,
        )
    )
    if not st:
        raise HTTPException(status_code=404, detail="Студента не знайдено")
    await db.delete(st)
    await db.commit()
    return {"status": "deleted"}
