from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import Faculty, Group, Room, Schedule, Subject, Teacher
from app.services.schedule import fetch_schedule
from seed import ensure_faculty, ensure_schedule_rows


@pytest.mark.anyio
async def test_seed_reuses_legacy_faculty_by_exact_name_and_repairs_short_name():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as db:
        faculty = Faculty(
            name="Faculty of Information Technologies",
            short_name=None,
            is_active=False,
        )
        db.add(faculty)
        await db.flush()

        seeded = await ensure_faculty(db)
        await db.commit()

        assert seeded.id == faculty.id
        assert seeded.short_name == "FIT"
        assert seeded.is_active is True
        assert (await db.scalars(select(Faculty))).all() == [faculty]
    await engine.dispose()


@pytest.mark.anyio
async def test_seed_fills_existing_group_and_is_idempotent():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as db:
        faculty = Faculty(name="FIT", short_name="FIT")
        group = Group(name="85", faculty=faculty)
        teachers = [Teacher(name="Teacher")]
        subjects = [Subject(name="Subject")]
        rooms = [Room(name="101")]
        db.add_all([faculty, group, *teachers, *subjects, *rooms])
        await db.flush()

        await ensure_schedule_rows(db, group, teachers, subjects, rooms)
        await ensure_schedule_rows(db, group, teachers, subjects, rooms)
        rows = (await db.scalars(select(Schedule).where(Schedule.group_id == group.id))).all()
        assert len(rows) == 21
        assert {row.week_type for row in rows} == {"denominator", "both", "numerator"}
        assert {row.day_of_week for row in rows} == set(range(1, 8))

        await db.commit()
        for offset in range(7):
            _, lessons = await fetch_schedule(db, group.id, date(2025, 9, 1 + offset))
            assert lessons, f"expected seeded lessons for day {offset + 1}"
    await engine.dispose()
