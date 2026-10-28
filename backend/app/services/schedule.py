from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, joinedload, selectinload, with_loader_criteria

from app.models import ImportedScheduleChange, Schedule, SchedulePeriod, SchedulePeriodSlot, ScheduleVersion
from app.services.settings import settings_service
from app.services.week import get_week_type


def _schedule_load_options(target_date: date | None = None, start_date: date | None = None, end_date: date | None = None):
    return (
        joinedload(Schedule.subject),
        joinedload(Schedule.group),
        joinedload(Schedule.teacher),
        joinedload(Schedule.second_teacher),
        
    )


from app.services.projection import build_projection


async def fetch_schedule(
    db: AsyncSession,
    target_date: date,
    group_id: int | None = None,
    teacher_id: int | None = None,
    day_of_week: int | None = None,
    semester_start: date | None = None,
    periods: list | None = None,
    include_cancelled: bool = False,
):
    if semester_start is None:
        semester_start = await settings_service.get_semester_start(db)
    if day_of_week is not None and day_of_week != target_date.isoweekday():
        target_date = target_date + timedelta(days=day_of_week - target_date.isoweekday())
    week_type = get_week_type(target_date, semester_start)
    lessons = await build_projection(
        db,
        target_date=target_date,
        group_id=group_id,
        teacher_id=teacher_id,
        include_cancelled=include_cancelled,
    )
    return week_type, lessons


from app.schemas.common import SchedulePeriodInfo

def resolve_active_period_info(periods: list, target_date: date, group_id: int | None = None) -> SchedulePeriodInfo | None:
    if not periods:
        return None
    for p in periods:
        if not (p.start_date <= target_date <= p.end_date):
            continue
        # Global holiday / period without explicit groups
        if not p.groups:
            return SchedulePeriodInfo(
                id=p.id,
                name=p.name,
                period_type=p.period_type,
                start_date=p.start_date,
                end_date=p.end_date,
            )
        # Group-scoped period
        if group_id and any(getattr(g, "id", None) == group_id for g in p.groups):
            return SchedulePeriodInfo(
                id=p.id,
                name=p.name,
                period_type=p.period_type,
                start_date=p.start_date,
                end_date=p.end_date,
            )
    return None

async def _active_periods(db: AsyncSession, target_date: date):
    result = await db.scalars(
        select(SchedulePeriod)
        .where(SchedulePeriod.start_date <= target_date, SchedulePeriod.end_date >= target_date)
        .options(selectinload(SchedulePeriod.groups))
    )
    return result.unique().all()



from app.services.projection import build_projection, build_week_projection

async def fetch_week_schedule(
    db: AsyncSession,
    start_date: date,
    group_id: int | None = None,
    teacher_id: int | None = None,
    include_cancelled: bool = False,
):
    """Fetch date-aware schedules for weekdays using a single batched query pass."""
    return await build_week_projection(
        db, start_date, group_id=group_id, teacher_id=teacher_id, include_cancelled=include_cancelled
    )


def week_types_overlap(left: str, right: str) -> bool:
    return left == "both" or right == "both" or left == right


async def conflicting_lesson(db, *, group_id, day_of_week, lesson_number, week_type,
                              teacher_id=None, second_teacher_id=None, subject_id=None, stream_id=None,
                              exclude_id=None, version_id=None, effective_date: date | None = None):
    """
    Returns a conflicting Schedule row for an overlapping slot in the same group
    or for either teacher, except when both groups share the same explicit stream.
    """
    from app.core.time import today_local
    ref_date = effective_date or today_local()
    query = select(Schedule).options(joinedload(Schedule.group)).where(
        Schedule.day_of_week == day_of_week,
        Schedule.lesson_number == lesson_number,
        Schedule.is_active.is_(True),
        or_(Schedule.effective_from.is_(None), Schedule.effective_from <= ref_date),
        or_(Schedule.effective_until.is_(None), Schedule.effective_until >= ref_date),
    )
    if version_id is not None:
        query = query.where(Schedule.version_id == version_id)
    else:
        query = query.where(Schedule.version_id.is_(None))
        
    if exclude_id is not None:
        query = query.where(Schedule.id != exclude_id)

    teacher_ids = {t for t in (teacher_id, second_teacher_id) if t is not None}
    conditions = [Schedule.group_id == group_id]
    if teacher_ids:
        conditions.append(
            Schedule.teacher_id.in_(teacher_ids) | Schedule.second_teacher_id.in_(teacher_ids)
        )
    query = query.where(or_(*conditions))

    for item in (await db.scalars(query)).all():
        if week_types_overlap(item.week_type, week_type):
            if item.group_id != group_id:
                if (
                    stream_id is not None
                    and item.stream_id == stream_id
                    and item.subject_id == subject_id
                    and item.teacher_id == teacher_id
                    and item.second_teacher_id == second_teacher_id
                ):
                    continue
            return item
    return None
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from app.models import Curriculum, Group, Subject, Teacher

async def _entity(db: AsyncSession, model, entity_id, name, label, required=False):
    if entity_id is None and name is None and required:
        raise HTTPException(422, f"{label} є обов'язковим")
    if entity_id is not None:
        value = await db.get(model, entity_id)
    elif name is not None:
        value = await db.scalar(select(model).where(model.name == name.strip(), model.is_active.is_(True)))
    else:
        return None
    if value is None or (hasattr(value, "is_active") and not value.is_active):
        raise HTTPException(422, f"{label} не існує")
    return value

async def _stream_id_for_lesson(db: AsyncSession, group_id, subject_id, teacher_id, second_teacher_id):
    query = select(Curriculum.stream_id).where(
        Curriculum.group_id == group_id,
        Curriculum.subject_id == subject_id,
        Curriculum.teacher_id == teacher_id,
        Curriculum.second_teacher_id == second_teacher_id,
        Curriculum.is_stream.is_(True),
        Curriculum.stream_id.is_not(None),
    )
    stream_ids = set((await db.scalars(query)).all())
    return next(iter(stream_ids)) if len(stream_ids) == 1 else None

async def _check_schedule_conflict(db: AsyncSession, group_id, day, lesson_number, week_type, exclude_id, teacher_id=None, second_teacher_id=None, subject_id=None, stream_id=None, version_id=None):
    conflict = await conflicting_lesson(db, group_id=group_id, day_of_week=day,
                                        lesson_number=lesson_number, week_type=week_type,
                                        teacher_id=teacher_id, second_teacher_id=second_teacher_id,
                                        subject_id=subject_id, stream_id=stream_id, exclude_id=exclude_id, version_id=version_id)
    if conflict:
        day_names = {1: "Понеділок", 2: "Вівторок", 3: "Середа", 4: "Четвер", 5: "П'ятниця", 6: "Субота", 7: "Неділя"}
        week_names = {"numerator": "по чисельнику", "denominator": "по знаменнику", "both": "щотижня"}
        d_name = day_names.get(day, str(day))
        w_name = week_names.get(conflict.week_type, conflict.week_type)
        if conflict.group_id != group_id:
            group_name = conflict.group.name if conflict.group else "???"
            raise HTTPException(409, f"Викладач уже веде заняття в цей час (група {group_name})")
        raise HTTPException(409, f"Неможливо зберегти: на {d_name} ({lesson_number}-а пара, {w_name}) уже призначене інше заняття.")

async def _resolve_entities(db: AsyncSession, item, payload, group_id, create):
    group = await _entity(db, Group, group_id, None, "group", required=True)
    if not create and payload.subject_id is None and payload.subject is None:
        subject = await db.get(Subject, item.subject_id)
    else:
        subject = await _entity(db, Subject, payload.subject_id, payload.subject, "subject",
                                required=create and payload.subject_id is None and payload.subject is None)
    if not create and "teacher_id" not in payload.model_fields_set and "teacher" not in payload.model_fields_set:
        teacher = await db.get(Teacher, item.teacher_id) if item.teacher_id is not None else None
    else:
        teacher = await _entity(db, Teacher, payload.teacher_id, payload.teacher, "teacher")
    if not create and "second_teacher_id" not in payload.model_fields_set:
        second_teacher = await db.get(Teacher, item.second_teacher_id) if item.second_teacher_id is not None else None
    else:
        second_teacher = await _entity(db, Teacher, getattr(payload, "second_teacher_id", None), None, "second_teacher")
    
    if group is None or subject is None:
        raise HTTPException(422, "Група та предмет є обов'язковими")
        
    return group, subject, teacher, second_teacher

async def _apply_and_commit(db: AsyncSession, item, payload, group, subject, teacher, second_teacher, day, lesson_number, week_type, stream_id, create):
    if not create:
        from app.services.lesson_notes import reconcile_template_notes
        await reconcile_template_notes(db, item, group_id=group.id, subject_id=subject.id,
            day=day, lesson_number=lesson_number, week_type=week_type,
            actor_id=db.info.get("note_actor_id"))
    item.group_id = group.id
    item.subject_id = subject.id
    item.teacher_id = teacher.id if teacher else (None if "teacher_id" in payload.model_fields_set or "teacher" in payload.model_fields_set else item.teacher_id)
    if "second_teacher_id" in payload.model_fields_set:
        item.second_teacher_id = second_teacher.id if second_teacher else None
    item.day_of_week = day
    item.lesson_number = lesson_number
    item.week_type = week_type
    item.stream_id = stream_id
    if getattr(payload, "is_replacement", None) is not None:
        item.is_replacement = payload.is_replacement
    if "room" in payload.model_fields_set:
        item.room_override = payload.room.strip() if payload.room and payload.room.strip() else None

    try:
        await db.commit()
        await db.refresh(item, ["group", "subject", "teacher", "second_teacher"])
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Неможливо зберегти: такий запис або графік вже існує і перетинається з іншим.") from exc
    return item

async def save_schedule_item(item, payload, db: AsyncSession, *, create=False):
    group_id = payload.group_id if payload.group_id is not None else item.group_id
    day = payload.day_of_week or (payload.date.isoweekday() if payload.date else item.day_of_week)
    lesson_number = payload.lesson_number if payload.lesson_number is not None else item.lesson_number
    week_type = payload.week_type or item.week_type

    with db.no_autoflush:
        group, subject, teacher, second_teacher = await _resolve_entities(db, item, payload, group_id, create)
        stream_id = await _stream_id_for_lesson(
            db,
            group_id,
            subject.id,
            teacher.id if teacher else None,
            second_teacher.id if second_teacher else None,
        )
        await _check_schedule_conflict(db, group_id, day, lesson_number, week_type, None if create else item.id,
                                       teacher_id=teacher.id if teacher else None,
                                       second_teacher_id=second_teacher.id if second_teacher else None,
                                       subject_id=subject.id if subject else None,
                                       stream_id=stream_id,
                                       version_id=item.version_id)
    return await _apply_and_commit(db, item, payload, group, subject, teacher, second_teacher, day, lesson_number, week_type, stream_id, create)
