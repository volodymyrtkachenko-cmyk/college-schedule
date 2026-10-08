from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import date
from typing import Optional

from app.database import get_db
from app.models import ScheduleOverride, User, Group, Subject, Teacher
from app.routers.auth import get_current_user

from app.routers.schedule_versions import lock_versions
from app.services.lesson_notes import active_note, archive_note, authorize_group
from app.services.projection import build_projection


router = APIRouter(prefix="/api/schedule/dated", tags=["Dated Actions"])

def require_editor(user: User = Depends(get_current_user)):
    if user.role not in ("admin", "editor"):
        raise HTTPException(403, "Not enough permissions")
    return user


class DatedMovePayload(BaseModel):
    source_group_id: int
    source_date: date
    source_lesson_number: int
    target_group_id: int
    target_date: date
    target_lesson_number: int
    expected_note_revision: Optional[int] = None
    reason: Optional[str] = None
    idempotency_key: Optional[str] = None

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
    await lock_versions(db)
    await authorize_group(db, actor, payload.group_id)
    
    note = await active_note(db, payload.group_id, payload.date, payload.lesson_number)
    if note:
        await archive_note(db, note, "lesson_deleted", actor.id)
        
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
    await lock_versions(db)
    await authorize_group(db, actor, payload.group_id)
    
    projection = await build_projection(db, payload.date, group_id=payload.group_id)
    matches = [item for item in projection if item.lesson_number == payload.lesson_number]
    
    note = await active_note(db, payload.group_id, payload.date, payload.lesson_number)
    if note:
        if not matches or matches[0].subject_id != payload.subject_id:
            await archive_note(db, note, "subject_changed", actor.id)
            
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

from app.services.lesson_notes import snapshot_revision
from app.models.lesson_notes import utcnow

@router.post("/move")
async def move_dated_lesson(
    payload: DatedMovePayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_editor)
):
    await lock_versions(db)
    await authorize_group(db, actor, payload.source_group_id)
    if payload.source_group_id != payload.target_group_id:
        await authorize_group(db, actor, payload.target_group_id)
        
    # Read projection for source and target
    source_proj = await build_projection(db, payload.source_date, group_id=payload.source_group_id)
    target_proj = await build_projection(db, payload.target_date, group_id=payload.target_group_id)
    
    source_matches = [item for item in source_proj if item.lesson_number == payload.source_lesson_number and not getattr(item, 'is_cancelled', False)]
    target_matches = [item for item in target_proj if item.lesson_number == payload.target_lesson_number and not getattr(item, 'is_cancelled', False)]
    
    if not source_matches:
        raise HTTPException(404, "Заняття для перенесення не знайдено (або воно вже скасоване)")
    if target_matches:
        raise HTTPException(409, "У цільовій парі вже є заняття")
        
    source_item = source_matches[0]
    
    note = await active_note(db, payload.source_group_id, payload.source_date, payload.source_lesson_number)
    if note and payload.expected_note_revision is not None and note.revision != payload.expected_note_revision:
        raise HTTPException(409, "Примітку вже змінили. Оновіть розклад.")
        
    ovr_cancel = ScheduleOverride(
        group_id=payload.source_group_id,
        date=payload.source_date,
        lesson_number=payload.source_lesson_number,
        cancelled=True
    )
    db.add(ovr_cancel)
    
    ovr_replace = ScheduleOverride(
        group_id=payload.target_group_id,
        date=payload.target_date,
        lesson_number=payload.target_lesson_number,
        subject_id=source_item.subject_id,
        teacher_id=source_item.teacher_id,
        second_teacher_id=source_item.second_teacher_id,
        room=source_item.room,
        stream_id=source_item.stream_id,
        cancelled=False
    )
    db.add(ovr_replace)
    
    if note:
        note.group_id = payload.target_group_id
        note.note_date = payload.target_date
        note.lesson_number = payload.target_lesson_number
        note.revision += 1
        note.updated_by = actor.id
        note.updated_at = utcnow()
        await snapshot_revision(db, note, "moved", actor.id)
        
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Помилка перенесення: конфлікт збереження")
    return {"status": "moved"}
