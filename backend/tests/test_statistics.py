from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import (
    Curriculum,
    Group,
    Schedule,
    SchedulePeriod,
    SchedulePeriodSlot,
    Subject,
    Teacher,
)
from app.routers.statistics import statistics
from app.schemas.statistics import StatisticsResponse
from app.services.settings import settings_service
from app.services.statistics import group_statistics, teacher_statistics


@pytest.fixture
async def statistics_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        yield session
    await engine.dispose()


@pytest.mark.anyio
async def test_group_and_teacher_statistics_apply_week_types_and_calendar_periods(statistics_db):
    group = Group(name="Statistics group")
    teacher = Teacher(name="Statistics teacher")
    regular_subject = Subject(name="Regular subject")
    practice_subject = Subject(name="Practice subject")
    statistics_db.add_all([group, teacher, regular_subject, practice_subject])
    await statistics_db.flush()
    statistics_db.add_all([
        Curriculum(
            group_id=group.id,
            subject_id=regular_subject.id,
            teacher_id=teacher.id,
            pairs_per_2_weeks=2,
            total_hours=10,
        ),
        Schedule(
            group_id=group.id,
            teacher_id=teacher.id,
            subject_id=regular_subject.id,
            day_of_week=1,
            lesson_number=1,
            week_type="numerator",
            is_active=True,
        ),
        Schedule(
            group_id=group.id,
            teacher_id=teacher.id,
            subject_id=regular_subject.id,
            day_of_week=2,
            lesson_number=2,
            week_type="both",
            is_active=True,
        ),
    ])
    statistics_db.add_all([
        SchedulePeriod(
            name="One-day holiday",
            period_type="holiday",
            start_date=date(2026, 9, 8),
            end_date=date(2026, 9, 8),
            groups=[group],
        ),
        SchedulePeriod(
            name="Practice",
            period_type="practice",
            start_date=date(2026, 9, 9),
            end_date=date(2026, 9, 9),
            groups=[group],
            slots=[
                SchedulePeriodSlot(
                    group_id=group.id,
                    subject_id=practice_subject.id,
                    teacher_id=teacher.id,
                    day_of_week=3,
                    lesson_number=1,
                )
            ],
        ),
    ])
    await statistics_db.commit()

    start = date(2026, 8, 31)
    through = date(2026, 9, 11)
    group_result = await group_statistics(statistics_db, group, start, through)
    teacher_result = await teacher_statistics(statistics_db, teacher, start, through)

    regular = next(item for item in group_result["entries"] if item["id"] == regular_subject.id)
    practice = next(item for item in group_result["entries"] if item["id"] == practice_subject.id)
    assert (regular["completed_hours"], regular["planned_hours"], regular["progress_percent"]) == (4, 10, 40)
    assert (practice["completed_hours"], practice["planned_hours"]) == (2, 0)
    assert group_result["total_hours"] == 6
    assert teacher_result["total_hours"] == 6
    assert teacher_result["entries"] == [{"id": group.id, "name": group.name, "completed_hours": 6}]


@pytest.mark.anyio
async def test_teacher_total_counts_shared_stream_once_but_group_breakdown_keeps_each_group(statistics_db):
    group_one = Group(name="Stream group one")
    group_two = Group(name="Stream group two")
    teacher = Teacher(name="Stream teacher")
    subject = Subject(name="Stream subject")
    statistics_db.add_all([group_one, group_two, teacher, subject])
    await statistics_db.flush()
    statistics_db.add_all([
        Schedule(
            group_id=group.id,
            teacher_id=teacher.id,
            subject_id=subject.id,
            stream_id="shared-stream",
            day_of_week=1,
            lesson_number=1,
            week_type="both",
            is_active=True,
        )
        for group in (group_one, group_two)
    ])
    await statistics_db.commit()

    result = await teacher_statistics(
        statistics_db,
        teacher,
        date(2026, 8, 31),
        date(2026, 8, 31),
    )

    assert result["total_hours"] == 2
    assert sum(item["completed_hours"] for item in result["entries"]) == 4


@pytest.mark.anyio
async def test_statistics_endpoint_returns_typed_data_and_requires_one_target(statistics_db, monkeypatch):
    group = Group(name="Endpoint group")
    statistics_db.add(group)
    await statistics_db.commit()
    monkeypatch.setattr(
        settings_service,
        "get_semester_start",
        AsyncMock(return_value=date.today()),
    )
    monkeypatch.setattr(
        settings_service,
        "get_configured_semester_end",
        AsyncMock(return_value=None),
    )

    result = await statistics(group.id, None, statistics_db)

    assert isinstance(result, StatisticsResponse)
    assert result.mode == "student"
    assert result.entries == []
    with pytest.raises(HTTPException) as error:
        await statistics(None, None, statistics_db)
    assert error.value.status_code == 422


@pytest.mark.anyio
async def test_statistics_endpoint_caps_through_date_at_inclusive_semester_end(
    statistics_db, monkeypatch
):
    group = Group(name="Bounded endpoint group")
    statistics_db.add(group)
    await statistics_db.commit()
    semester_end = date.today() - timedelta(days=1)
    semester_start = semester_end - timedelta(days=30)
    monkeypatch.setattr(
        settings_service,
        "get_semester_start",
        AsyncMock(return_value=semester_start),
    )
    monkeypatch.setattr(
        settings_service,
        "get_configured_semester_end",
        AsyncMock(return_value=semester_end),
    )
    statistics_mock = AsyncMock(return_value={
        "mode": "student",
        "semester_start": semester_start,
        "through_date": semester_end,
        "total_hours": 0,
        "planned_hours": 0,
        "entries": [],
    })
    monkeypatch.setattr("app.routers.statistics.group_statistics", statistics_mock)

    result = await statistics(group.id, None, statistics_db)

    assert result.through_date == semester_end
    statistics_mock.assert_awaited_once_with(
        statistics_db, group, semester_start, semester_end
    )
