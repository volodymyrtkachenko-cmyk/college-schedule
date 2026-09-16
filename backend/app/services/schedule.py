from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload, with_loader_criteria

from app.models import LessonNote, Schedule, Teacher
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
    
    conditions = [
        Schedule.day_of_week == weekday,
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", week_type)),
    ]
    if group_id is not None:
        conditions.append(Schedule.group_id == group_id)
    if teacher_id is not None:
        conditions.append(or_(Schedule.teacher_id == teacher_id, Schedule.second_teacher_id == teacher_id))
        
    query = (
        select(Schedule)
        .where(*conditions)
        .options(*_schedule_load_options(target_date=target_date))
    )
    return week_type, (await db.scalars(query.order_by(Schedule.lesson_number))).unique().all()


async def fetch_week_schedule(db: AsyncSession, start_date: date, group_id: int | None = None, teacher_id: int | None = None):
    """Fetch a whole week and its notes in one batched schedule/notes load."""
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(start_date, semester_start)
    end_date = start_date + timedelta(days=6)
    
    conditions = [
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", week_type)),
        Schedule.day_of_week.between(1, 5),
    ]
    if group_id is not None:
        conditions.append(Schedule.group_id == group_id)
    if teacher_id is not None:
        conditions.append(or_(Schedule.teacher_id == teacher_id, Schedule.second_teacher_id == teacher_id))
        
    query = (
        select(Schedule)
        .where(*conditions)
        .options(*_schedule_load_options(start_date=start_date, end_date=end_date))
        .order_by(Schedule.day_of_week, Schedule.lesson_number)
    )
    lessons = (await db.scalars(query)).unique().all()
    return week_type, lessons


def week_types_overlap(left: str, right: str) -> bool:
    return left == "both" or right == "both" or left == right


async def conflicting_lesson(db, *, group_id, day_of_week, lesson_number, week_type,
                              teacher_id=None, second_teacher_id=None, exclude_id=None):
    """
    Returns a conflicting Schedule row, if any, for the same group/day/lesson slot
    with an overlapping week type, OR for either teacher already booked in that
    same day/lesson slot (as main or second teacher) in an overlapping week,
    regardless of group.
    """
    query = select(Schedule).where(
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
            return item
    return None