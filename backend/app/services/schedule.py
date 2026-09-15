from datetime import date, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload, with_loader_criteria
from app.models import LessonNote, Schedule
from app.services.settings import settings_service
from app.services.week import get_week_type

async def fetch_schedule(db: AsyncSession, group_id: int, target_date: date,
                          teacher_id: int | None = None, room_id: int | None = None,
                          day_of_week: int | None = None):
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(target_date, semester_start)
    weekday = target_date.isoweekday() if day_of_week is None else day_of_week
    query = (select(Schedule).where(Schedule.group_id == group_id, Schedule.day_of_week == weekday,
             Schedule.is_active.is_(True), (Schedule.week_type == "both") | (Schedule.week_type == week_type))
             .options(joinedload(Schedule.subject), joinedload(Schedule.teacher),
                      joinedload(Schedule.room), selectinload(Schedule.notes),
                      with_loader_criteria(LessonNote, LessonNote.note_date == target_date)))
    if teacher_id is not None:
        query = query.where(Schedule.teacher_id == teacher_id)
    if room_id is not None:
        query = query.where(Schedule.room_id == room_id)
    return week_type, (await db.scalars(query.order_by(Schedule.lesson_number))).unique().all()


async def fetch_week_schedule(db: AsyncSession, group_id: int, start_date: date):
    """Fetch a whole week and its notes in one batched schedule/notes load."""
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(start_date, semester_start)
    end_date = start_date + timedelta(days=6)
    query = (
        select(Schedule)
        .where(
            Schedule.group_id == group_id,
            Schedule.is_active.is_(True),
            Schedule.week_type.in_(("both", week_type)),
            Schedule.day_of_week.between(1, 7),
        )
        .options(
            joinedload(Schedule.subject),
            joinedload(Schedule.teacher),
            joinedload(Schedule.room),
            selectinload(Schedule.notes),
            with_loader_criteria(
                LessonNote,
                LessonNote.note_date.between(start_date, end_date),
            ),
        )
        .order_by(Schedule.day_of_week, Schedule.lesson_number)
    )
    lessons = (await db.scalars(query)).unique().all()
    return week_type, lessons


def week_types_overlap(left: str, right: str) -> bool:
    return left == "both" or right == "both" or left == right


async def conflicting_lesson(db, *, group_id, day_of_week, lesson_number, week_type, exclude_id=None):
    query = select(Schedule).where(
        Schedule.group_id == group_id, Schedule.day_of_week == day_of_week,
        Schedule.lesson_number == lesson_number, Schedule.is_active.is_(True),
    )
    if exclude_id is not None:
        query = query.where(Schedule.id != exclude_id)
    for item in (await db.scalars(query)).all():
        if week_types_overlap(item.week_type, week_type):
            return item
    return None
