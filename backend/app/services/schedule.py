from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload, with_loader_criteria

from app.models import LessonNote, Schedule, SchedulePeriod, SchedulePeriodSlot
from app.services.settings import settings_service
from app.services.week import get_week_type


def _schedule_load_options(target_date: date | None = None, start_date: date | None = None, end_date: date | None = None):
    note_criteria = LessonNote.note_date == target_date if target_date is not None else LessonNote.note_date.between(start_date, end_date)
    return (
        joinedload(Schedule.subject),
        joinedload(Schedule.group),
        joinedload(Schedule.teacher),
        joinedload(Schedule.second_teacher),
        selectinload(Schedule.notes),
        with_loader_criteria(LessonNote, note_criteria),
    )


async def fetch_schedule(db: AsyncSession, target_date: date,
                          group_id: int | None = None,
                          teacher_id: int | None = None,
                          day_of_week: int | None = None):
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(target_date, semester_start)
    weekday = target_date.isoweekday() if day_of_week is None else day_of_week

    periods = await _active_periods(db, target_date)
    holidays = [period for period in periods if period.period_type == "holiday"]
    if any(not period.groups for period in holidays):
        return week_type, []

    holiday_group_ids = {group.id for period in holidays for group in period.groups}
    if group_id is not None and group_id in holiday_group_ids:
        return week_type, []

    practice_periods = [period for period in periods if period.period_type == "practice"]
    substitution_periods = [period for period in periods if period.period_type == "substitution"]
    practice_group_ids = {group.id for period in practice_periods for group in period.groups}
    unavailable_group_ids = holiday_group_ids | practice_group_ids
    conditions = [
        Schedule.day_of_week == weekday,
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", week_type)),
    ]
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

    # Apply ScheduleOverrides for hiding cancelled classes
    if regular_lessons:
        from app.models.entities import ScheduleOverride
        override_query = select(ScheduleOverride).where(
            ScheduleOverride.date == target_date,
            ScheduleOverride.schedule_id.in_([l.id for l in regular_lessons]),
            ScheduleOverride.cancelled == True
        )
        cancelled_schedule_ids = set((await db.scalars(override_query)).all())
        # wait, we need schedule_id
        cancelled_schedule_ids = set()
        overrides = (await db.scalars(override_query)).all()
        for o in overrides:
            cancelled_schedule_ids.add(o.schedule_id)
        
        filtered_lessons = []
        for lesson in regular_lessons:
            if lesson.id not in cancelled_schedule_ids:
                filtered_lessons.append(lesson)
        regular_lessons = filtered_lessons

    practice_slots = []
    if practice_periods or substitution_periods:
        period_ids = [period.id for period in practice_periods] + [period.id for period in substitution_periods]
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

    return week_type, sorted(
        [*regular_lessons, *practice_slots],
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
    lessons_by_day = {}
    for weekday in range(1, 6):
        target_date = start_date + timedelta(days=weekday - 1)
        _, lessons_by_day[weekday] = await fetch_schedule(
            db,
            target_date,
            group_id=group_id,
            teacher_id=teacher_id,
            day_of_week=weekday,
        )
    return week_type, lessons_by_day


def week_types_overlap(left: str, right: str) -> bool:
    return left == "both" or right == "both" or left == right


async def conflicting_lesson(db, *, group_id, day_of_week, lesson_number, week_type,
                              teacher_id=None, second_teacher_id=None, subject_id=None, stream_id=None,
                              exclude_id=None):
    """
    Returns a conflicting Schedule row for an overlapping slot in the same group
    or for either teacher, except when both groups share the same explicit stream.
    """
    query = select(Schedule).options(joinedload(Schedule.group)).where(
        Schedule.day_of_week == day_of_week,
        Schedule.lesson_number == lesson_number,
        Schedule.is_active.is_(True),
    )
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