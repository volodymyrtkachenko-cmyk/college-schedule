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
    teacher_id: Optional[int] = None
    title: Optional[str] = Field(default=None, max_length=200)
    event_type: str = Field(default="exam", pattern="^(exam|consultation|credit|defense|general)$")
    event_date: date
    start_time: str = Field(default="09:00", max_length=10)
    end_time: Optional[str] = Field(default=None, max_length=10)
    room: Optional[str] = Field(default=None, max_length=50)
    note: Optional[str] = Field(default=None, max_length=500)


class EventResponseItem(BaseModel):
    id: int
    group_id: int
    group_name: Optional[str] = None
    subject_id: Optional[int] = None
    subject_name: Optional[str] = None
    teacher_id: Optional[int] = None
    teacher_name: Optional[str] = None
    title: str
    event_type: str
    event_date: date
    start_time: str
    end_time: Optional[str] = None
    room: Optional[str] = None
    note: Optional[str] = None


def _serialize_event(ev: AcademicEvent) -> EventResponseItem:
    resolved_title = (
        (ev.title or "").strip()
        or (ev.subject.name if ev.subject else "Подія")
    )
    return EventResponseItem(
        id=ev.id,
        group_id=ev.group_id,
        group_name=ev.group.name if ev.group else None,
        subject_id=ev.subject_id,
        subject_name=ev.subject.name if ev.subject else None,
        teacher_id=ev.teacher_id,
        teacher_name=ev.teacher.name if ev.teacher else None,
        title=resolved_title,
        event_type=ev.event_type,
        event_date=ev.event_date,
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

    if not payload.subject_id and not (payload.title and payload.title.strip()):
        raise HTTPException(status_code=422, detail="Вкажіть предмет або назву події")

    ev = AcademicEvent(
        group_id=payload.group_id,
        subject_id=payload.subject_id,
        teacher_id=payload.teacher_id,
        title=payload.title.strip() if payload.title else None,
        event_type=payload.event_type,
        event_date=payload.event_date,
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
