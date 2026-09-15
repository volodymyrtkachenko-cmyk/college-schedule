from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.schemas import LessonMutation, ScheduleItem, ScheduleResponse
from app.core.security import require_roles
from app.models import Group, Room, Schedule, Subject, Teacher
from app.services.schedule import fetch_schedule, fetch_week_schedule, conflicting_lesson

router = APIRouter()

def to_item(item, week_type, target_date):
    matching_note = next((n for n in item.notes if n.note_date == target_date), None)
    return ScheduleItem(id=item.id, subject_id=item.subject_id, teacher_id=item.teacher_id,
        room_id=item.room_id, day_of_week=item.day_of_week, lesson_number=item.lesson_number,
        time=f"{item.start_time.strftime('%H:%M')}-{item.end_time.strftime('%H:%M')}",
        subject=item.subject.name, teacher=item.teacher.name if item.teacher else None,
        room=item.room.name if item.room else None,
        subject_name=item.subject.name, teacher_name=item.teacher.name if item.teacher else None,
        room_name=item.room.name if item.room else None, week_type=item.week_type,
        is_relevant_this_week=item.week_type in ("both", week_type),
        note=matching_note.note if matching_note else None,
        note_id=matching_note.id if matching_note else None)

@router.get("/schedule", response_model=ScheduleResponse)
async def schedule(group_id: int = Query(...), teacher_id: int | None = None,
                   room_id: int | None = None, day_of_week: int | None = Query(None, ge=1, le=7),
                   target_date: date | None = None, db: AsyncSession = Depends(get_db)):
    target_date = target_date or date.today()
    week_type, lessons = await fetch_schedule(db, group_id, target_date, teacher_id, room_id, day_of_week)
    return ScheduleResponse(date=target_date, week_type=week_type,
                            lessons=[to_item(x, week_type, target_date) for x in lessons])

@router.get("/schedule/today", response_model=ScheduleResponse)
async def today(group_id: int = Query(...), db: AsyncSession = Depends(get_db)):
    return await schedule(group_id=group_id, day_of_week=None, db=db)

@router.get("/schedule/week")
async def week(group_id: int = Query(...), target_date: date | None = None,
               db: AsyncSession = Depends(get_db)):
    requested = target_date or date.today()
    start = requested - timedelta(days=requested.isoweekday() - 1)
    week_type, lessons = await fetch_week_schedule(db, group_id, start)
    by_day = {}
    for lesson in lessons:
        by_day.setdefault(lesson.day_of_week, []).append(lesson)
    return [
        ScheduleResponse(
            date=start + timedelta(days=i),
            week_type=week_type,
            lessons=[
                to_item(lesson, week_type, start + timedelta(days=i))
                for lesson in by_day.get(i + 1, [])
            ],
        )
        for i in range(7)
    ]

async def _entity(db, model, entity_id, name, label, required=False):
    if entity_id is None and name is None and required:
        raise HTTPException(422, f"{label} is required")
    if entity_id is not None:
        value = await db.get(model, entity_id)
    elif name is not None:
        value = await db.scalar(select(model).where(model.name == name.strip(), model.is_active.is_(True)))
    else:
        return None
    if value is None or (hasattr(value, "is_active") and not value.is_active):
        raise HTTPException(422, f"{label} does not exist")
    return value

async def _save(item, payload, db, *, create=False):
    group_id = payload.group_id if payload.group_id is not None else item.group_id
    day = payload.day_of_week or (payload.date.isoweekday() if payload.date else item.day_of_week)
    lesson_number = payload.lesson_number if payload.lesson_number is not None else item.lesson_number
    week_type = payload.week_type or item.week_type
    # IMPORTANT: `item` may already be pending in the session (added via db.add()
    # but not yet fully populated with its NOT NULL columns, when create=True).
    # Any query below (conflicting_lesson, db.get, select(...)) would otherwise
    # trigger SQLAlchemy's autoflush and try to INSERT that half-built row,
    # raising a NotNullViolation. Wrap every lookup query in db.no_autoflush
    # (a plain, synchronous context manager -- use "with", not "async with")
    # until the row is fully populated and ready to be flushed intentionally
    # at commit time below.
    with db.no_autoflush:
        conflict = await conflicting_lesson(db, group_id=group_id, day_of_week=day,
                                            lesson_number=lesson_number, week_type=week_type,
                                            exclude_id=None if create else item.id)
        if conflict:
            raise HTTPException(409, f"Lesson conflicts with lesson id {conflict.id} "
                                    f"(group {group_id}, day {day}, lesson {lesson_number}, {conflict.week_type})")
        group = await _entity(db, Group, group_id, None, "group", required=True)
        if not create and payload.subject_id is None and payload.subject is None:
            subject = await db.get(Subject, item.subject_id)
        else:
            subject = await _entity(db, Subject, payload.subject_id, payload.subject, "subject",
                                    required=create and payload.subject_id is None and payload.subject is None)
        teacher = await _entity(db, Teacher, payload.teacher_id, payload.teacher, "teacher")
        room = await _entity(db, Room, payload.room_id, payload.room, "room")
    if group is None or subject is None:
        raise HTTPException(422, "group and subject are required")
    item.group_id = group.id
    item.subject_id = subject.id
    item.teacher_id = teacher.id if teacher else (None if payload.teacher_id is not None or payload.teacher is not None else item.teacher_id)
    item.room_id = room.id if room else (None if payload.room_id is not None or payload.room is not None else item.room_id)
    item.day_of_week = day
    item.lesson_number = lesson_number
    item.week_type = week_type
    for field in ("start_time", "end_time"):
        value = getattr(payload, field)
        if value is not None:
            setattr(item, field, value)
    if item.start_time >= item.end_time:
        raise HTTPException(422, "start_time must be before end_time")
    try:
        await db.commit()
        await db.refresh(item, ["subject", "teacher", "room", "notes"])
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Schedule conflicts with an existing record") from exc
    return to_item(item, item.week_type, payload.date or date.today())

@router.post("/schedule", response_model=ScheduleItem, status_code=status.HTTP_201_CREATED)
async def create_lesson(payload: LessonMutation, db: AsyncSession = Depends(get_db),
                        _: object = Depends(require_roles("admin", "editor"))):
    if payload.group_id is None or payload.subject_id is None and payload.subject is None or \
            payload.lesson_number is None or payload.start_time is None or payload.end_time is None or \
            payload.day_of_week is None and payload.date is None:
        raise HTTPException(422, "group, subject, day, lesson_number and times are required")
    # NOTE: Schedule is intentionally created with only start_time/end_time/is_active here.
    # The remaining NOT NULL columns (group_id, subject_id, day_of_week, lesson_number, ...)
    # are filled in by _save() below, which also runs the conflict check and commits.
    # Do NOT call db.flush()/db.commit() between db.add(item) and _save(item, ...) --
    # doing so tries to INSERT the row before those required fields are set and raises
    # a NotNullViolation (this previously broke lesson creation).
    item = Schedule(start_time=payload.start_time, end_time=payload.end_time, is_active=True)
    db.add(item)
    return await _save(item, payload, db, create=True)

@router.patch("/schedule/{lesson_id}", response_model=ScheduleItem)
async def update_lesson(lesson_id: int, payload: LessonMutation, db: AsyncSession = Depends(get_db),
                        _: object = Depends(require_roles("admin", "editor"))):
    item = await db.get(Schedule, lesson_id)
    if item is None or not item.is_active:
        raise HTTPException(404, "Lesson not found")
    return await _save(item, payload, db)

@router.delete("/schedule/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson(lesson_id: int, db: AsyncSession = Depends(get_db),
                        _: object = Depends(require_roles("admin", "editor"))):
    item = await db.get(Schedule, lesson_id)
    if item is None or not item.is_active:
        raise HTTPException(404, "Lesson not found")
    item.is_active = False
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Unable to delete lesson") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)