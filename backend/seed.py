import asyncio
import os
from datetime import time
from sqlalchemy import select
from app.database import async_session_factory
from app.core.security import hash_password
from app.models import Faculty, Group, Room, Schedule, Subject, Teacher, User
from app.services.settings import settings_service

WEEK_TYPES = ("denominator", "both", "numerator")
DEFAULT_FACULTY_NAME = "Faculty of Information Technologies"
DEFAULT_FACULTY_SHORT_NAME = "FIT"
DEFAULT_SEMESTER_START = "2025-09-01"


async def ensure_faculty(db):
    """Reuse legacy records so seeding never creates a duplicate faculty."""
    faculty = await db.scalar(
        select(Faculty).where(Faculty.name == DEFAULT_FACULTY_NAME)
    )
    if faculty is None:
        faculty = await db.scalar(
            select(Faculty).where(Faculty.short_name == DEFAULT_FACULTY_SHORT_NAME)
        )
    if faculty is None:
        faculty = Faculty(
            name=DEFAULT_FACULTY_NAME,
            short_name=DEFAULT_FACULTY_SHORT_NAME,
        )
        db.add(faculty)
    elif not faculty.is_active:
        # Only touch fields that are actually broken; never overwrite
        # a legacy short_name someone set on purpose.
        faculty.is_active = True
    await db.flush()
    return faculty


async def ensure_schedule_rows(db, group, teachers, subjects, rooms):
    """Fill the demo schedule for the target group without duplicating rows."""
    existing = {
        (row.day_of_week, row.lesson_number)
        for row in (
            await db.scalars(select(Schedule).where(Schedule.group_id == group.id))
        ).all()
    }
    # Mon-Fri (1-5), 3 lessons/day. Change to range(1, 7) if Saturday classes exist.
    for day in range(1, 6):
        for lesson in range(1, 4):
            if (day, lesson) in existing:
                continue
            db.add(Schedule(
                group_id=group.id,
                teacher_id=teachers[(day + lesson) % len(teachers)].id,
                room_id=rooms[(day + lesson) % len(rooms)].id,
                subject_id=subjects[(day + lesson) % len(subjects)].id,
                day_of_week=day,
                lesson_number=lesson,
                start_time=time(8 + lesson, 30),
                end_time=time(9 + lesson, 20),
                week_type=WEEK_TYPES[lesson - 1],
            ))
    await db.flush()


async def seed():
    async with async_session_factory() as db:
        admin_username = os.getenv("ADMIN_USERNAME")
        admin_password = os.getenv("ADMIN_PASSWORD")
        if admin_username and admin_password:
            admin = await db.scalar(select(User).where(User.username == admin_username))
            if not admin:
                db.add(User(username=admin_username, name=admin_username, role="admin",
                            password_hash=hash_password(admin_password)))

        faculty = await ensure_faculty(db)

        group = await db.scalar(select(Group).where(Group.name == "85"))
        if not group:
            group = Group(name="85", faculty_id=faculty.id)
            db.add(group)
            await db.flush()

        teachers = []
        for name in ["Olena Kovalenko", "Ivan Petrenko", "Maria Shevchenko", "Andrii Bondar", "Iryna Melnyk"]:
            teacher = await db.scalar(select(Teacher).where(Teacher.name == name))
            if not teacher:
                teacher = Teacher(name=name)
                db.add(teacher)
                await db.flush()
            teachers.append(teacher)

        subjects = []
        for name in ["Programming", "Databases", "Web Technologies", "Mathematics", "Project Management"]:
            subject = await db.scalar(select(Subject).where(Subject.name == name))
            if not subject:
                subject = Subject(name=name)
                db.add(subject)
                await db.flush()
            subjects.append(subject)

        rooms = []
        for name in ["101", "102", "201", "202", "301"]:
            room = await db.scalar(select(Room).where(Room.name == name))
            if not room:
                room = Room(name=name)
                db.add(room)
                await db.flush()
            rooms.append(room)

        await ensure_schedule_rows(db, group, teachers, subjects, rooms)

        # Don't clobber a semester_start the admin already changed via the UI.
        existing_semester_start = await settings_service.get(db, "semester_start")
        if existing_semester_start is None:
            await settings_service.set(db, "semester_start", DEFAULT_SEMESTER_START)

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())