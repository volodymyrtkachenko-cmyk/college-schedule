from datetime import date, time, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.schemas import LessonMutation, ScheduleItem, ScheduleResponse
from app.core.security import require_roles
from app.models import Group, Schedule, Subject, Teacher
from app.services.schedule import fetch_schedule, fetch_week_schedule, conflicting_lesson

router = APIRouter()


def format_teacher_name(name: str) -> str:
    if not name:
        return name
    parts = [p.strip("., ") for p in name.split() if p.strip("., ")]
    if len(parts) >= 3:
        return f"{parts[0]} {parts[1][0].upper()}. {parts[2][0].upper()}."
    elif len(parts) == 2:
        return f"{parts[0]} {parts[1][0].upper()}."
    return name

def to_item(item, week_type, target_date):

    matching_note = next((n for n in item.notes if n.note_date == target_date), None)
    t_names = []
    t_rooms = []
    if item.teacher:
        t_names.append(format_teacher_name(item.teacher.name))
        if item.teacher.room:
            t_rooms.append(item.teacher.room)
    if getattr(item, "second_teacher", None):
        t_names.append(format_teacher_name(item.second_teacher.name))
        if item.second_teacher.room:
            t_rooms.append(item.second_teacher.room)
    teacher_name = " / ".join(t_names) if t_names else None
    room_name = " / ".join(t_rooms) if t_rooms else None
    return ScheduleItem(id=item.id, group_id=item.group_id, subject_id=item.subject_id, teacher_id=item.teacher_id, second_teacher_id=item.second_teacher_id,
        day_of_week=item.day_of_week, lesson_number=item.lesson_number,
        time=f"{item.start_time.strftime('%H:%M')}-{item.end_time.strftime('%H:%M')}",
        subject=item.subject.name, teacher=teacher_name, room=room_name,
        subject_name=item.subject.name, teacher_name=teacher_name,
        week_type=item.week_type,
        is_relevant_this_week=item.week_type in ("both", week_type),
        group_name=getattr(item.group, "name", None),
        note=matching_note.note if matching_note else None,
        note_id=matching_note.id if matching_note else None)

@router.get("/schedule", response_model=ScheduleResponse)
async def schedule(group_id: int | None = None, teacher_id: int | None = None,
                   day_of_week: int | None = Query(None, ge=1, le=7),
                   target_date: date | None = None, db: AsyncSession = Depends(get_db)):
    target_date = target_date or date.today()
    week_type, lessons = await fetch_schedule(db=db, target_date=target_date, group_id=group_id, teacher_id=teacher_id, day_of_week=day_of_week)
    return ScheduleResponse(date=target_date, week_type=week_type,
                            lessons=[to_item(x, week_type, target_date) for x in lessons])

@router.get("/schedule/today", response_model=ScheduleResponse)
async def today(group_id: int | None = None, teacher_id: int | None = None, db: AsyncSession = Depends(get_db)):
    return await schedule(group_id=group_id, teacher_id=teacher_id, day_of_week=None, db=db)

@router.get("/schedule/week")
async def week(group_id: int | None = None, teacher_id: int | None = None, target_date: date | None = None,
               db: AsyncSession = Depends(get_db)):
    requested = target_date or date.today()
    start = requested - timedelta(days=requested.isoweekday() - 1)
    week_type, lessons = await fetch_week_schedule(db, start, group_id, teacher_id)
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
        for i in range(5)
    ]

async def _entity(db, model, entity_id, name, label, required=False):
    if entity_id is None and name is None and required:
        raise HTTPException(422, f"{label} є обов\'язковим")
    if entity_id is not None:
        value = await db.get(model, entity_id)
    elif name is not None:
        value = await db.scalar(select(model).where(model.name == name.strip(), model.is_active.is_(True)))
    else:
        return None
    if value is None or (hasattr(value, "is_active") and not value.is_active):
        raise HTTPException(422, f"{label} не існує")
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
            day_names = {1: "Понеділок", 2: "Вівторок", 3: "Середу", 4: "Четвер", 5: "П'ятницю", 6: "Суботу", 7: "Неділю"}
            week_names = {"numerator": "по чисельнику", "denominator": "по знаменнику", "both": "щотижня"}
            d_name = day_names.get(day, str(day))
            w_name = week_names.get(conflict.week_type, conflict.week_type)
            raise HTTPException(409, f"Неможливо зберегти: на {d_name} ({lesson_number}-а пара, {w_name}) уже призначене інше заняття.")
        group = await _entity(db, Group, group_id, None, "group", required=True)
        if not create and payload.subject_id is None and payload.subject is None:
            subject = await db.get(Subject, item.subject_id)
        else:
            subject = await _entity(db, Subject, payload.subject_id, payload.subject, "subject",
                                    required=create and payload.subject_id is None and payload.subject is None)
        teacher = await _entity(db, Teacher, payload.teacher_id, payload.teacher, "teacher")
        second_teacher = await _entity(db, Teacher, getattr(payload, "second_teacher_id", None), None, "second_teacher")

    if group is None or subject is None:
        raise HTTPException(422, "Група та предмет є обов\'язковими")
    item.group_id = group.id
    item.subject_id = subject.id
    item.teacher_id = teacher.id if teacher else (None if "teacher_id" in payload.model_fields_set or "teacher" in payload.model_fields_set else item.teacher_id)
    if "second_teacher_id" in payload.model_fields_set:
        item.second_teacher_id = second_teacher.id if second_teacher else None
    item.day_of_week = day
    item.lesson_number = lesson_number
    item.week_type = week_type
    for field in ("start_time", "end_time"):
        value = getattr(payload, field)
        if value is not None:
            setattr(item, field, value)
    if item.start_time >= item.end_time:
        raise HTTPException(422, "Час початку має бути раніше часу завершення")
    try:
        await db.commit()
        await db.refresh(item, ["subject", "teacher", "second_teacher", "notes"])
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Неможливо зберегти: такий запис або графік вже існує і перетинається з іншим.") from exc
    return to_item(item, item.week_type, payload.date or date.today())

@router.post("/schedule", response_model=ScheduleItem, status_code=status.HTTP_201_CREATED)
async def create_lesson(payload: LessonMutation, db: AsyncSession = Depends(get_db),
                        _: object = Depends(require_roles("admin", "editor"))):
    if payload.group_id is None or payload.subject_id is None and payload.subject is None or \
            payload.lesson_number is None or payload.start_time is None or payload.end_time is None or \
            payload.day_of_week is None and payload.date is None:
        raise HTTPException(422, "Не всі обов\'язкові поля заповнені")
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
        raise HTTPException(404, "Заняття не знайдено")
    return await _save(item, payload, db)

@router.delete("/schedule/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson(lesson_id: int, db: AsyncSession = Depends(get_db),
                        _: object = Depends(require_roles("admin", "editor"))):
    item = await db.get(Schedule, lesson_id)
    if item is None or not item.is_active:
        raise HTTPException(404, "Заняття не знайдено")
    item.is_active = False
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Не вдалося видалити заняття") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
from pydantic import BaseModel
class BulkCuratorRequest(BaseModel):
    day_of_week: int
    lesson_number: int
    week_type: str
    group_ids: list[int]
    action: str = "create" # "create" or "delete"

import traceback
@router.post("/schedule/bulk-curator")
async def bulk_curator_hours(payload: BulkCuratorRequest, db: AsyncSession = Depends(get_db), _: object = Depends(require_roles("admin"))):
    try:
        subject_name = "Виховна година"
        # Find or create subject
    sub_query = await db.execute(select(Subject).where(Subject.name == subject_name))
    subject = sub_query.scalar_first()
    if not subject:
        subject = Subject(name=subject_name)
        db.add(subject)
        await db.flush()
        
    query = select(Group).where(Group.is_active == True)
    if payload.group_ids:
        query = query.where(Group.id.in_(payload.group_ids))
    groups = (await db.scalars(query)).all()
    
    deleted_count = 0
    created_count = 0
    skipped_count = 0
    
    for group in groups:
        # Delete existing curator hour at this specific time slot to avoid duplicates when creating,
        # or if action is simply 'delete'
        del_query = delete(Schedule).where(
            Schedule.group_id == group.id,
            Schedule.subject_id == subject.id,
            Schedule.day_of_week == payload.day_of_week,
            Schedule.lesson_number == payload.lesson_number
        )
        # If specific week type passed for deletion, maybe filter it? We'll just delete any matching the time slot.
        res = await db.execute(del_query)
        deleted_count += res.rowcount
        
        if payload.action == "create":
            # Check for conflict with OTHER subjects
            conflict = await conflicting_lesson(
                db, group_id=group.id, day_of_week=payload.day_of_week,
                lesson_number=payload.lesson_number, week_type=payload.week_type
            )
            if conflict:
                skipped_count += 1
                continue
                
            new_lesson = Schedule(
                group_id=group.id,
                subject_id=subject.id,
                teacher_id=group.curator_id, # Can be null if no curator
                day_of_week=payload.day_of_week,
                lesson_number=payload.lesson_number,
                week_type=payload.week_type,
                start_time=time(9,0) if payload.lesson_number == 1 else time(10,40) if payload.lesson_number == 2 else time(12,30) if payload.lesson_number == 3 else time(14,0),
                end_time=time(10,20) if payload.lesson_number == 1 else time(12,0) if payload.lesson_number == 2 else time(13,50) if payload.lesson_number == 3 else time(15,20),
                is_active=True
            )
            db.add(new_lesson)
            created_count += 1
            
    await db.commit()
    return {"created": created_count, "deleted": deleted_count, "skipped": skipped_count}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=traceback.format_exc())
