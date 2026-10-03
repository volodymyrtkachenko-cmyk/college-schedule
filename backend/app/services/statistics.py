from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.models import (
    Curriculum,
    Group,
    Schedule,
    SchedulePeriod,
    SchedulePeriodSlot,
    ImportedScheduleChange,
    Teacher,
)
from app.services.week import get_week_type


async def group_statistics(
    db: AsyncSession,
    group: Group,
    semester_start: date,
    through_date: date,
) -> dict:
    curricula = (
        await db.scalars(
            select(Curriculum)
            .where(Curriculum.group_id == group.id)
            .options(joinedload(Curriculum.subject))
        )
    ).unique().all()
    scheduled, total_hours = await _scheduled_hours(
        db, semester_start, through_date, group_id=group.id
    )

    planned_by_subject: dict[int, int] = defaultdict(int)
    names = {item.subject_id: item.subject.name for item in curricula}
    for item in curricula:
        planned_by_subject[item.subject_id] += item.total_hours

    subject_ids = set(planned_by_subject) | set(scheduled)
    entries = [
        {
            "id": subject_id,
            "name": names[subject_id] if subject_id in names else scheduled[subject_id]["name"],
            "completed_hours": scheduled.get(subject_id, {}).get("hours", 0),
            "planned_hours": planned_by_subject.get(subject_id, 0),
            "progress_percent": (
                scheduled.get(subject_id, {}).get("hours", 0) * 100 / planned_by_subject[subject_id]
                if planned_by_subject.get(subject_id, 0) > 0
                else None
            ),
        }
        for subject_id in subject_ids
    ]
    entries.sort(key=lambda item: item["name"].casefold())

    return {
        "mode": "student",
        "semester_start": semester_start,
        "through_date": through_date,
        "total_hours": total_hours,
        "planned_hours": sum(planned_by_subject.values()),
        "entries": entries,
    }


async def teacher_statistics(
    db: AsyncSession,
    teacher: Teacher,
    semester_start: date,
    through_date: date,
) -> dict:
    scheduled, total_hours = await _scheduled_hours(
        db, semester_start, through_date, teacher_id=teacher.id
    )
    entries = [
        {
            "id": group_id,
            "name": item["name"],
            "completed_hours": item["hours"],
        }
        for group_id, item in scheduled.items()
    ]
    entries.sort(key=lambda item: item["name"].casefold())

    return {
        "mode": "teacher",
        "semester_start": semester_start,
        "through_date": through_date,
        "total_hours": total_hours,
        "entries": entries,
    }


async def _scheduled_hours(
    db: AsyncSession,
    semester_start: date,
    through_date: date,
    *,
    group_id: int | None = None,
    teacher_id: int | None = None,
) -> tuple[dict[int, dict], int]:
    if group_id is not None:
        schedule_filter = Schedule.group_id == group_id
    else:
        schedule_filter = or_(
            Schedule.teacher_id == teacher_id,
            Schedule.second_teacher_id == teacher_id,
        )

    schedules = (
        await db.scalars(
            select(Schedule)
            .where(Schedule.is_active.is_(True), schedule_filter)
            .options(joinedload(Schedule.group), joinedload(Schedule.subject))
        )
    ).unique().all()
    periods = (
        await db.scalars(
            select(SchedulePeriod)
            .where(
                SchedulePeriod.start_date <= through_date,
                SchedulePeriod.end_date >= semester_start,
            )
            .options(
                selectinload(SchedulePeriod.groups),
                selectinload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.group),
                selectinload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.subject),
            )
        )
    ).unique().all()
    imported_changes = (
        await db.scalars(
            select(ImportedScheduleChange)
            .where(
                ImportedScheduleChange.date >= semester_start,
                ImportedScheduleChange.date <= through_date,
                ImportedScheduleChange.is_published.is_(True),
            )
            .options(
                joinedload(ImportedScheduleChange.group),
                joinedload(ImportedScheduleChange.subject),
                joinedload(ImportedScheduleChange.teacher),
                joinedload(ImportedScheduleChange.second_teacher),
            )
        )
    ).unique().all()
    latest_changes: dict[tuple[date, int, int], ImportedScheduleChange] = {}
    for item in imported_changes:
        key = (item.date, item.group_id, item.lesson_number)
        current = latest_changes.get(key)
        if current is None or item.version > current.version:
            latest_changes[key] = item

    result: dict[int, dict] = {}
    unique_teacher_lessons: set[tuple] = set()
    current_date = semester_start
    while current_date <= through_date:
        if current_date.isoweekday() <= 5:
            week_type = get_week_type(current_date, semester_start)
            active_periods = [
                period
                for period in periods
                if period.start_date <= current_date <= period.end_date
            ]
            holidays = [period for period in active_periods if period.period_type == "holiday"]
            if not any(not period.groups for period in holidays):
                holiday_group_ids = {
                    item.id for period in holidays for item in period.groups
                }
                practice_periods = [
                    period for period in active_periods if period.period_type == "practice"
                ]
                practice_group_ids = {
                    item.id for period in practice_periods for item in period.groups
                }

                for item in schedules:
                    imported_change = latest_changes.get(
                        (current_date, item.group_id, item.lesson_number)
                    )
                    if (
                        item.day_of_week != current_date.isoweekday()
                        or item.week_type not in ("both", week_type)
                        or item.group_id in holiday_group_ids | practice_group_ids
                        or imported_change is not None
                    ):
                        continue
                    _record_lesson(
                        result,
                        unique_teacher_lessons,
                        item.group_id,
                        item.group.name,
                        item.subject_id,
                        item.subject.name,
                        current_date,
                        item.lesson_number,
                        item.id,
                        item.stream_id,
                        teacher_id is not None,
                    )

                for change in latest_changes.values():
                    if (
                        change.date != current_date
                        or change.kind != "substitution"
                        or change.subject_id is None
                        or change.group_id in holiday_group_ids | practice_group_ids
                        or (group_id is not None and change.group_id != group_id)
                        or (
                            teacher_id is not None
                            and teacher_id
                            not in (change.teacher_id, change.second_teacher_id)
                        )
                    ):
                        continue
                    _record_lesson(
                        result,
                        unique_teacher_lessons,
                        change.group_id,
                        change.group.name,
                        change.subject_id,
                        change.subject.name,
                        current_date,
                        change.lesson_number,
                        change.id,
                        None,
                        teacher_id is not None,
                    )

                for period in practice_periods:
                    for slot in period.slots:
                        if (
                            slot.day_of_week != current_date.isoweekday()
                            or slot.group_id in holiday_group_ids
                            or (
                                teacher_id is not None
                                and teacher_id
                                not in (slot.teacher_id, slot.second_teacher_id)
                            )
                            or (
                                group_id is not None
                                and slot.group_id != group_id
                            )
                        ):
                            continue
                        _record_lesson(
                            result,
                            unique_teacher_lessons,
                            slot.group_id,
                            slot.group.name,
                            slot.subject_id,
                            slot.subject.name,
                            current_date,
                            slot.lesson_number,
                            slot.id,
                            None,
                            teacher_id is not None,
                        )
        current_date += timedelta(days=1)

    total_hours = (
        len(unique_teacher_lessons) * 2
        if teacher_id is not None
        else sum(item["hours"] for item in result.values())
    )
    return result, total_hours


def _record_lesson(
    result: dict[int, dict],
    unique_teacher_lessons: set[tuple],
    group_id: int,
    group_name: str,
    subject_id: int,
    subject_name: str,
    lesson_date: date,
    lesson_number: int,
    lesson_id: int,
    stream_id: str | None,
    is_teacher: bool,
) -> None:
    key = group_id if is_teacher else subject_id
    name = group_name if is_teacher else subject_name
    entry = result.setdefault(key, {"name": name, "hours": 0})
    entry["hours"] += 2
    if is_teacher:
        unique_teacher_lessons.add(
            (lesson_date, lesson_number, "stream", stream_id)
            if stream_id
            else (lesson_date, "lesson", lesson_id)
        )
