from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.database import get_db
from app.models import AcademicEvent, User
from app.core.security import require_roles

router = APIRouter(prefix="/api/events", tags=["events"])


class EventCreatePayload(BaseModel):
    group_id: int
    subject_id: Optional[int] = None
    custom_subject: Optional[str] = Field(default=None, max_length=200)
    teacher_id: Optional[int] = None
    title: Optional[str] = Field(default=None, max_length=200)
    event_type: str = Field(default="exam", pattern="^(exam|consultation|credit|defense|general)$")
    event_date: date
    lesson_number: Optional[int] = Field(default=None, ge=1, le=8)
    start_time: str = Field(default="09:00", max_length=10)
    end_time: Optional[str] = Field(default=None, max_length=10)
    room: Optional[str] = Field(default=None, max_length=50)
    note: Optional[str] = Field(default=None, max_length=500)


class EventUpdatePayload(BaseModel):
    group_id: Optional[int] = None
    subject_id: Optional[int] = None
    custom_subject: Optional[str] = Field(default=None, max_length=200)
    teacher_id: Optional[int] = None
    title: Optional[str] = Field(default=None, max_length=200)
    event_type: Optional[str] = Field(default=None, pattern="^(exam|consultation|credit|defense|general)$")
    event_date: Optional[date] = None
    lesson_number: Optional[int] = Field(default=None, ge=1, le=8)
    start_time: Optional[str] = Field(default=None, max_length=10)
    end_time: Optional[str] = Field(default=None, max_length=10)
    room: Optional[str] = Field(default=None, max_length=50)
    note: Optional[str] = Field(default=None, max_length=500)


class EventResponseItem(BaseModel):
    id: int
    group_id: int
    group_name: Optional[str] = None
    subject_id: Optional[int] = None
    subject_name: Optional[str] = None
    custom_subject: Optional[str] = None
    teacher_id: Optional[int] = None
    teacher_name: Optional[str] = None
    title: str
    event_type: str
    event_date: date
    lesson_number: Optional[int] = None
    start_time: str
    end_time: Optional[str] = None
    room: Optional[str] = None
    note: Optional[str] = None


def _serialize_event(ev: AcademicEvent) -> EventResponseItem:
    resolved_title = (
        (ev.title or "").strip()
        or (ev.custom_subject or "").strip()
        or (ev.subject.name if ev.subject else "Подія")
    )
    resolved_subject_name = (
        (ev.custom_subject or "").strip()
        or (ev.subject.name if ev.subject else None)
        or resolved_title
    )
    return EventResponseItem(
        id=ev.id,
        group_id=ev.group_id,
        group_name=ev.group.name if ev.group else None,
        subject_id=ev.subject_id,
        subject_name=resolved_subject_name,
        custom_subject=ev.custom_subject,
        teacher_id=ev.teacher_id,
        teacher_name=ev.teacher.name if ev.teacher else None,
        title=resolved_title,
        event_type=ev.event_type,
        event_date=ev.event_date,
        lesson_number=ev.lesson_number,
        start_time=ev.start_time,
        end_time=ev.end_time,
        room=ev.room,
        note=ev.note,
    )


async def _get_user_allowed_groups(db: AsyncSession, user: User) -> set[int]:
    u = await db.scalar(select(User).options(selectinload(User.allowed_groups)).where(User.id == user.id))
    return {g.id for g in u.allowed_groups} if u else set()


@router.get("", response_model=list[EventResponseItem])
async def list_events(
    group_id: Optional[int] = None,
    teacher_id: Optional[int] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
):
    conds = []
    if group_id is not None:
        conds.append(AcademicEvent.group_id == group_id)
    if teacher_id is not None:
        conds.append(AcademicEvent.teacher_id == teacher_id)
    if from_date is not None:
        conds.append(AcademicEvent.event_date >= from_date)
    if to_date is not None:
        conds.append(AcademicEvent.event_date <= to_date)

    stmt = (
        select(AcademicEvent)
        .where(*conds)
        .options(
            joinedload(AcademicEvent.group),
            joinedload(AcademicEvent.subject),
            joinedload(AcademicEvent.teacher),
        )
        .order_by(AcademicEvent.event_date.asc(), AcademicEvent.start_time.asc())
    )
    rows = (await db.scalars(stmt)).all()
    return [_serialize_event(r) for r in rows]


@router.post("", response_model=EventResponseItem, status_code=status.HTTP_201_CREATED)
async def create_event(
    payload: EventCreatePayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles("admin", "editor")),
):
    if actor.role == "editor":
        allowed = await _get_user_allowed_groups(db, actor)
        if payload.group_id not in allowed:
            raise HTTPException(status_code=403, detail="Немає доступу до цієї групи")

    has_subject = bool(payload.subject_id or (payload.custom_subject and payload.custom_subject.strip()))
    has_title = bool(payload.title and payload.title.strip())
    if not has_subject and not has_title:
        raise HTTPException(status_code=422, detail="Вкажіть предмет або назву події")

    lesson_num = payload.lesson_number
    if not lesson_num and payload.start_time:
        try:
            h, m = map(int, payload.start_time.split(":")[:2])
            mins = h * 60 + m
            if mins < 10 * 60 + 30:
                lesson_num = 1
            elif mins < 12 * 60 + 15:
                lesson_num = 2
            elif mins < 13 * 60 + 55:
                lesson_num = 3
            elif mins < 15 * 60 + 25:
                lesson_num = 4
            else:
                lesson_num = 5
        except Exception:
            lesson_num = 1

    ev = AcademicEvent(
        group_id=payload.group_id,
        subject_id=payload.subject_id,
        custom_subject=payload.custom_subject.strip() if payload.custom_subject else None,
        teacher_id=payload.teacher_id,
        title=payload.title.strip() if payload.title else None,
        event_type=payload.event_type,
        event_date=payload.event_date,
        lesson_number=lesson_num,
        start_time=payload.start_time.strip(),
        end_time=payload.end_time.strip() if payload.end_time else None,
        room=payload.room.strip() if payload.room else None,
        note=payload.note.strip() if payload.note else None,
    )
    db.add(ev)
    await db.commit()

    stmt = (
        select(AcademicEvent)
        .where(AcademicEvent.id == ev.id)
        .options(
            joinedload(AcademicEvent.group),
            joinedload(AcademicEvent.subject),
            joinedload(AcademicEvent.teacher),
        )
    )
    loaded = await db.scalar(stmt)
    return _serialize_event(loaded)


@router.patch("/{event_id}", response_model=EventResponseItem)
async def update_event(
    event_id: int,
    payload: EventUpdatePayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles("admin", "editor")),
):
    ev = await db.get(AcademicEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Подію не знайдено")
    if actor.role == "editor":
        allowed = await _get_user_allowed_groups(db, actor)
        if ev.group_id not in allowed:
            raise HTTPException(status_code=403, detail="Немає доступу до цієї групи")
        if payload.group_id is not None and payload.group_id not in allowed:
            raise HTTPException(status_code=403, detail="Немає доступу до нової групи")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "custom_subject":
            ev.custom_subject = value.strip() if value else None
        elif field == "title":
            ev.title = value.strip() if value else None
        elif field == "room":
            ev.room = value.strip() if value else None
        elif field == "note":
            ev.note = value.strip() if value else None
        elif field == "start_time" and value:
            ev.start_time = value.strip()
        else:
            setattr(ev, field, value)

    if "lesson_number" in update_data and payload.lesson_number is not None and "start_time" not in update_data:
        bell_defaults = {1: "09:00", 2: "10:40", 3: "12:30", 4: "14:00", 5: "15:30"}
        if payload.lesson_number in bell_defaults:
            ev.start_time = bell_defaults[payload.lesson_number]

    await db.commit()

    stmt = (
        select(AcademicEvent)
        .where(AcademicEvent.id == ev.id)
        .options(
            joinedload(AcademicEvent.group),
            joinedload(AcademicEvent.subject),
            joinedload(AcademicEvent.teacher),
        )
    )
    loaded = await db.scalar(stmt)
    return _serialize_event(loaded)


@router.delete("/{event_id}")
async def delete_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles("admin", "editor")),
):
    ev = await db.get(AcademicEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Подію не знайдено")
    if actor.role == "editor":
        allowed = await _get_user_allowed_groups(db, actor)
        if ev.group_id not in allowed:
            raise HTTPException(status_code=403, detail="Немає доступу до цієї групи")

    await db.delete(ev)
    await db.commit()
    return {"status": "deleted"}
