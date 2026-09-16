from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_roles
from app.database import get_db
from app.models import LessonNote, Schedule
from app.schemas import LessonNoteCreate, LessonNoteResponse, LessonNoteUpdate

router = APIRouter(prefix="/lesson-notes", tags=["lesson notes"])


async def _active_schedule(db: AsyncSession, schedule_id: int) -> Schedule:
    schedule = await db.get(Schedule, schedule_id)
    if schedule is None or not schedule.is_active:
        raise HTTPException(status_code=404, detail="Заняття в розкладі не знайдено")
    return schedule


@router.post("", response_model=LessonNoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    payload: LessonNoteCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "editor")),
):
    await _active_schedule(db, payload.schedule_id)
    existing = await db.scalar(
        select(LessonNote).where(
            LessonNote.schedule_id == payload.schedule_id,
            LessonNote.note_date == payload.note_date,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A note already exists for this lesson and date",
        )
    note = LessonNote(**payload.model_dump())
    db.add(note)
    try:
        await db.commit()
        await db.refresh(note)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A note already exists for this lesson and date",
        ) from exc
    return note


@router.get("", response_model=list[LessonNoteResponse])
async def list_notes(
    schedule_id: int | None = Query(default=None, gt=0),
    note_date: date | None = None,
    target_date: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    if note_date is not None and target_date is not None and note_date != target_date:
        raise HTTPException(status_code=422, detail="Дата примітки та дата розкладу не збігаються")
    note_date = target_date or note_date
    if schedule_id is not None:
        await _active_schedule(db, schedule_id)
    query = select(LessonNote).join(Schedule).where(Schedule.is_active.is_(True))
    if schedule_id is not None:
        query = query.where(LessonNote.schedule_id == schedule_id)
    if note_date is not None:
        query = query.where(LessonNote.note_date == note_date)
    return (await db.scalars(query.order_by(LessonNote.note_date, LessonNote.id))).all()


@router.get("/{note_id}", response_model=LessonNoteResponse)
async def get_note(note_id: int, db: AsyncSession = Depends(get_db)):
    note = await db.scalar(
        select(LessonNote).join(Schedule).where(
            LessonNote.id == note_id, Schedule.is_active.is_(True)
        )
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Примітку не знайдено")
    return note


@router.patch("/{note_id}", response_model=LessonNoteResponse)
async def update_note(
    note_id: int,
    payload: LessonNoteUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "editor")),
):
    note = await db.scalar(
        select(LessonNote).join(Schedule).where(
            LessonNote.id == note_id, Schedule.is_active.is_(True)
        )
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Примітку не знайдено")
    schedule_id = payload.schedule_id if payload.schedule_id is not None else note.schedule_id
    await _active_schedule(db, schedule_id)
    note_date = payload.note_date if payload.note_date is not None else note.note_date
    if schedule_id != note.schedule_id or note_date != note.note_date:
        existing = await db.scalar(
            select(LessonNote).where(
                LessonNote.schedule_id == schedule_id,
                LessonNote.note_date == note_date,
                LessonNote.id != note.id,
            )
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A note already exists for this lesson and date",
            )
    for field in ("schedule_id", "note_date", "note"):
        value = getattr(payload, field)
        if value is not None:
            setattr(note, field, value)
    try:
        await db.commit()
        await db.refresh(note)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A note already exists for this lesson and date",
        ) from exc
    return note


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin", "editor")),
):
    note = await db.scalar(
        select(LessonNote).join(Schedule).where(
            LessonNote.id == note_id, Schedule.is_active.is_(True)
        )
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Примітку не знайдено")
    await db.delete(note)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
