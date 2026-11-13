import hmac
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import bearer_scheme, get_current_user
from app.database import get_db
from app.schemas.classroom import (
    ClassroomDisconnectRequest,
    ClassroomSyncRequest,
    ClassroomUserSubmissionsRequest,
)
from app.services.classroom import sync as classroom_sync
from app.services.classroom import worker as classroom_worker

router = APIRouter()


@router.post("/sync")
async def sync_from_classroom(
    payload: ClassroomSyncRequest,
    db: AsyncSession = Depends(get_db),
):
    return await classroom_sync.sync_classroom_account_flow(payload, db)


@router.post("/disconnect")
async def disconnect_classroom_account(
    payload: ClassroomDisconnectRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    25.6: «Від'єднати» видаляє запис цього студента з classroom_credentials
    і відкликає його токен у Google. Інші записи групи не зачіпаються.
    """
    return await classroom_sync.disconnect_classroom_account_flow(payload, db)


@router.post("/user-submissions")
async def get_user_submissions_post(
    payload: Optional[ClassroomUserSubmissionsRequest] = None,
    x_classroom_user_id: Optional[str] = Header(None, alias="X-Classroom-User-Id"),
    x_classroom_email: Optional[str] = Header(None, alias="X-Classroom-Email"),
    db: AsyncSession = Depends(get_db),
):
    eff_group_id = payload.group_id if payload else None
    eff_user_id = (payload.google_user_id if payload else None) or x_classroom_user_id
    eff_email = (payload.email if payload else None) or x_classroom_email
    eff_access_token = payload.access_token if payload else None
    eff_refresh_token = payload.refresh_token if payload else None
    return await classroom_sync._fetch_user_submissions(
        db,
        group_id=eff_group_id,
        google_user_id=eff_user_id,
        email=eff_email,
        access_token=eff_access_token,
        refresh_token=eff_refresh_token,
    )


@router.get("/user-submissions")
async def get_user_submissions_get(
    group_id: Optional[int] = Query(None),
    google_user_id: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    access_token: Optional[str] = Query(None),
    refresh_token: Optional[str] = Query(None),
    x_classroom_user_id: Optional[str] = Header(None, alias="X-Classroom-User-Id"),
    x_classroom_email: Optional[str] = Header(None, alias="X-Classroom-Email"),
    db: AsyncSession = Depends(get_db),
):
    eff_user_id = google_user_id or x_classroom_user_id
    eff_email = email or x_classroom_email
    return await classroom_sync._fetch_user_submissions(
        db,
        group_id=group_id,
        google_user_id=eff_user_id,
        email=eff_email,
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/sync-all")
async def manual_trigger_sync_all(
    cron_key: Optional[str] = Header(None, alias="X-Cron-Key"),
    auth: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Ендпоінт для примусового запуску автосинхронізації всіх груп (адмін або валідний X-Cron-Key)."""
    cron_secret = (
        getattr(settings, "IMPORT_CRON_SECRET", None)
        or os.getenv("IMPORT_CRON_SECRET")
        or getattr(settings, "classroom_cron_secret", None)
        or os.getenv("CLASSROOM_CRON_SECRET")
    )
    is_valid_cron = bool(
        cron_secret
        and cron_key
        and hmac.compare_digest(cron_key.strip().encode(), cron_secret.strip().encode())
    )
    if not is_valid_cron:
        user = await get_current_user(credentials=auth, db=db)
        if user.role not in ("admin", "editor"):
            raise HTTPException(status_code=403, detail="Недостатньо прав")
    return await classroom_worker.sync_all_connected_groups_once(force=True)
