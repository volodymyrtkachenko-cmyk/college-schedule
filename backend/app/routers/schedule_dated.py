from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import date
from typing import Optional

from app.database import get_db
from app.models import ScheduleOverride, User, Group, Subject, Teacher
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/schedule/dated", tags=["Dated Actions"])

def require_editor(user: User = Depends(get_current_user)):
    if user.role not in ("admin", "editor"):
        raise HTTPException(403, "Not enough permissions")
    return user

class DatedCancelPayload(BaseModel):
    group_id: int
    date: date
    lesson_number: int

class DatedReplacePayload(BaseModel):
    group_id: int
    date: date
    lesson_number: int
    subject_id: Optional[int] = None
    teacher_id: Optional[int] = None
    second_teacher_id: Optional[int] = None
    room: Optional[str] = None
    stream_id: Optional[str] = None

@router.post("/cancel")
async def cancel_dated_lesson(
    payload: DatedCancelPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor)
):
    # Insert a ScheduleOverride with cancelled=True
    ovr = ScheduleOverride(
        group_id=payload.group_id,
        date=payload.date,
        lesson_number=payload.lesson_number,
        cancelled=True
    )
    db.add(ovr)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Конфлікт створення (можливо, override вже існує)")
    return {"status": "cancelled"}

@router.post("/replace")
async def replace_dated_lesson(
    payload: DatedReplacePayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor)
):
    ovr = ScheduleOverride(
        group_id=payload.group_id,
        date=payload.date,
        lesson_number=payload.lesson_number,
        subject_id=payload.subject_id,
        teacher_id=payload.teacher_id,
        second_teacher_id=payload.second_teacher_id,
        room=payload.room,
        stream_id=payload.stream_id,
        cancelled=False
    )
    db.add(ovr)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Конфлікт створення (можливо, override вже існує)")
    return {"status": "replaced"}
