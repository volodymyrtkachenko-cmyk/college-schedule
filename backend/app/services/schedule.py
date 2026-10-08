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
        selectinload(Schedule.notes),
    )


async def fetch_schedule(db: AsyncSession, target_date: date,
                          group_id: int | None = None,
                          teacher_id: int | None = None,
                          day_of_week: int | None = None,
                          semester_start: date | None = None,
                          periods: list | None = None):
    if semester_start is None:
        semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(target_date, semester_start)
    weekday = target_date.isoweekday() if day_of_week is None else day_of_week

    if periods is None:
        periods = await _active_periods(db, target_date)

    holidays = [period for period in periods if period.period_type in ("holiday", "session", "diploma", "attestation")]
    if any(not period.groups for period in holidays):
        return week_type, []

    holiday_group_ids = {group.id for period in holidays for group in period.groups}
    if group_id is not None and group_id in holiday_group_ids:
        return week_type, []

    practice_periods = [period for period in periods if period.period_type == "practice"]
    practice_group_ids = {group.id for period in practice_periods for group in period.groups}
    unavailable_group_ids = holiday_group_ids | practice_group_ids
    active_version = await db.scalar(
        select(ScheduleVersion).where(
            ScheduleVersion.valid_from <= target_date,
            ScheduleVersion.valid_until >= target_date,
            ScheduleVersion.is_active.is_(True)
        ).order_by(ScheduleVersion.valid_from.desc()).limit(1)
    )

    conditions = [
        Schedule.day_of_week == weekday,
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", week_type)),
    ]
    if active_version:
        conditions.append(Schedule.version_id == active_version.id)
    else:
        conditions.append(Schedule.version_id.is_(None))
    if group_id is not None:
        conditions.append(Schedule.group_id == group_id)
    if unavailable_group_ids:
        conditions.append(Schedule.group_id.not_in(unavailable_group_ids))
    if teacher_id is not None:
        conditions.append(or_(Schedule.teacher_id == teacher_id, Schedule.second_teacher_id == teacher_id))

    query = (
        select(Schedule)
        .where(*conditions)
        .options(*_schedule_load_options(target_date=target_date))
    )
    regular_lessons = list((await db.scalars(query.order_by(Schedule.lesson_number))).unique().all())

    previous_change = aliased(ImportedScheduleChange)
    latest_version = (
        select(previous_change.version)
        .where(
            previous_change.date == ImportedScheduleChange.date,
            previous_change.group_id == ImportedScheduleChange.group_id,
            previous_change.lesson_number == ImportedScheduleChange.lesson_number,
        )
        .order_by(previous_change.version.desc())
        .limit(1)
        .scalar_subquery()
    )
    imported_query = (
        select(ImportedScheduleChange)
        .where(
            ImportedScheduleChange.date == target_date,
            ImportedScheduleChange.is_published.is_(True),
            ImportedScheduleChange.version == latest_version,
        )
        .options(
            joinedload(ImportedScheduleChange.group),
            joinedload(ImportedScheduleChange.subject),
            joinedload(ImportedScheduleChange.teacher),
            joinedload(ImportedScheduleChange.second_teacher),
        )
    )
    imported_changes = (await db.scalars(imported_query)).unique().all()
    cancelled_cells = {
        (change.group_id, change.lesson_number)
        for change in imported_changes
        if change.kind == "cancelled"
    }
    substitutions = [
        change for change in imported_changes
        if change.kind == "substitution"
    ]

    # Apply ScheduleOverrides and imported cancellations/replacements.
    if regular_lessons:
        from app.models.entities import ScheduleOverride
        override_query = select(ScheduleOverride.schedule_id).where(
            ScheduleOverride.date == target_date,
            ScheduleOverride.schedule_id.in_([l.id for l in regular_lessons]),
            ScheduleOverride.cancelled == True
        )
        cancelled_schedule_ids = set((await db.scalars(override_query)).all())
        
        filtered_lessons = []
        for lesson in regular_lessons:
            if lesson.id not in cancelled_schedule_ids and (lesson.group_id, lesson.lesson_number) not in cancelled_cells and not any(
                change.group_id == lesson.group_id and change.lesson_number == lesson.lesson_number
                for change in substitutions
            ):
                filtered_lessons.append(lesson)
        regular_lessons = filtered_lessons

    practice_slots = []
    if practice_periods:
        period_ids = [period.id for period in practice_periods]
        slot_conditions = [
            SchedulePeriodSlot.period_id.in_(period_ids),
            SchedulePeriodSlot.day_of_week == weekday,
        ]
        if holiday_group_ids:
            slot_conditions.append(SchedulePeriodSlot.group_id.not_in(holiday_group_ids))
        if group_id is not None:
            slot_conditions.append(SchedulePeriodSlot.group_id == group_id)
        if teacher_id is not None:
            slot_conditions.append(or_(
                SchedulePeriodSlot.teacher_id == teacher_id,
                SchedulePeriodSlot.second_teacher_id == teacher_id,
            ))
        slot_query = (
            select(SchedulePeriodSlot)
            .where(*slot_conditions)
            .options(
                joinedload(SchedulePeriodSlot.group),
                joinedload(SchedulePeriodSlot.subject),
                joinedload(SchedulePeriodSlot.teacher),
                joinedload(SchedulePeriodSlot.second_teacher),
            )
        )
        practice_slots = (await db.scalars(slot_query)).unique().all()

    replacement_slots = [
        change for change in substitutions
        if not holiday_group_ids
        or change.group_id not in holiday_group_ids
    ]
    if group_id is not None:
        replacement_slots = [change for change in replacement_slots if change.group_id == group_id]
    if teacher_id is not None:
        replacement_slots = [
            change for change in replacement_slots
            if change.teacher_id == teacher_id or change.second_teacher_id == teacher_id
        ]

    return week_type, sorted(
        [*regular_lessons, *practice_slots, *replacement_slots],
        key=lambda item: (item.lesson_number, item.group.name),
    )


async def _active_periods(db: AsyncSession, target_date: date):
    result = await db.scalars(
        select(SchedulePeriod)
        .where(SchedulePeriod.start_date <= target_date, SchedulePeriod.end_date >= target_date)
        .options(selectinload(SchedulePeriod.groups))
    )
    return result.unique().all()



async def fetch_week_schedule(db: AsyncSession, start_date: date, group_id: int | None = None, teacher_id: int | None = None):
    """Fetch date-aware schedules for weekdays, including temporary periods."""
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(start_date, semester_start)
    
    end_date = start_date + timedelta(days=4)
    # Fetch all periods that overlap with this week
    all_periods = (await db.scalars(
        select(SchedulePeriod)
        .where(SchedulePeriod.start_date <= end_date, SchedulePeriod.end_date >= start_date)
        .options(selectinload(SchedulePeriod.groups))
    )).unique().all()

    lessons_by_day = {}
    for weekday in range(1, 6):
        target_date = start_date + timedelta(days=weekday - 1)
        # Filter periods for just this day to pass to fetch_schedule
        day_periods = [p for p in all_periods if p.start_date <= target_date <= p.end_date]
        
        _, lessons = await fetch_schedule(
            db,
            target_date,
            group_id=group_id,
            teacher_id=teacher_id,
            day_of_week=weekday,
            semester_start=semester_start,
            periods=day_periods
        )
        lessons_by_day[weekday] = lessons

    return week_type, lessons_by_day


def week_types_overlap(left: str, right: str) -> bool:
    return left == "both" or right == "both" or left == right


async def conflicting_lesson(db, *, group_id, day_of_week, lesson_number, week_type,
                              teacher_id=None, second_teacher_id=None, subject_id=None, stream_id=None,
                              exclude_id=None, version_id=None):
    """
    Returns a conflicting Schedule row for an overlapping slot in the same group
    or for either teacher, except when both groups share the same explicit stream.
    """
    query = select(Schedule).options(joinedload(Schedule.group)).where(
        Schedule.day_of_week == day_of_week,
        Schedule.lesson_number == lesson_number,
        Schedule.is_active.is_(True),
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
        await db.refresh(item, ["group", "subject", "teacher", "second_teacher", "notes"])
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
