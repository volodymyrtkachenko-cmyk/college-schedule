from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app
from app.models import (
    AcademicTerm,
    Group,
    SchedulePeriod,
    TermCourseSchedule,
)


@pytest.fixture
async def ep_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, sessions
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_educational_process_handles_global_periods_inferred_course_terms_and_summer(ep_client):
    client, sessions = ep_client
    async with sessions() as db:
        # Group without explicit year_of_admission -> inferred 2024 => 3rd course for 2026/2027
        g_inferred = Group(name="КІ-24-1/9-85", year_of_admission=None, is_active=True)
        # Group with explicit year_of_admission=2025 => 2nd course for 2026/2027
        g_explicit = Group(name="ЕА-25", year_of_admission=2025, is_active=True)
        db.add_all([g_inferred, g_explicit])
        await db.flush()

        # College-wide winter holidays spanning year boundary (no specific groups attached)
        global_holiday = SchedulePeriod(
            name="Зимові канікули",
            period_type="holiday",
            start_date=date(2026, 12, 28),
            end_date=date(2027, 1, 10),
            groups=[],
        )
        # Group-specific exam session overlapping part of late December for g_explicit
        group_session = SchedulePeriod(
            name="Екзаменаційна сесія",
            period_type="session",
            start_date=date(2026, 12, 14),
            end_date=date(2026, 12, 20),
            groups=[g_explicit],
        )
        db.add_all([global_holiday, group_session])

        # Term 1 only (testing that Feb-May isn't treated as summer break when Term 2 isn't added yet)
        term1 = AcademicTerm(
            name="2026/2027 · I семестр",
            academic_year="2026/2027",
            semester_number=1,
            start_date=date(2026, 9, 1),
            end_date=date(2026, 12, 25),
            total_weeks=17,
            is_current=True,
            status="ACTIVE",
        )
        term1.course_schedules = [
            TermCourseSchedule(
                course=3,
                total_weeks=17,
                practice_weeks=2,
                practice_timing="MIDDLE",
                practice_start_week=2,
                practice_end_week=3,
                theory_weeks=15,
            )
        ]
        db.add(term1)
        await db.commit()

    resp = await client.get("/api/educational-process?academic_year_start=2026")
    assert resp.status_code == 200
    payload = resp.json()

    assert payload["academic_year_start"] == 2026
    assert len(payload["weeks"]) == 52
    assert len(payload["semesters"]) == 1
    assert payload["semesters"][0]["semester_number"] == 1

    courses_by_num = {c["course"]: c["groups"] for c in payload["courses"]}
    assert 2 in courses_by_num
    assert 3 in courses_by_num

    g3 = next(g for g in courses_by_num[3] if g["group_name"] == "КІ-24-1/9-85")
    g2 = next(g for g in courses_by_num[2] if g["group_name"] == "ЕА-25")

    cells3 = {c["week_number"]: c for c in g3["cells"]}
    cells2 = {c["week_number"]: c for c in g2["cells"]}

    # Weeks 2 & 3 practice from TermCourseSchedule applied to 3rd course
    assert cells3[2]["period_type"] == "practice"
    assert cells3[3]["period_type"] == "practice"
    assert cells2[2]["period_type"] == "theory"

    # Global winter holiday (week 18: Dec 28 - Jan 3) applies to all groups
    assert cells3[18]["period_type"] == "holiday"
    assert cells2[18]["period_type"] == "holiday"

    # Group-specific session week 16 (Dec 14 - Dec 20) applies only to g2
    assert cells2[16]["period_type"] == "session"
    assert cells3[16]["period_type"] == "theory"

    # Spring week (week 30: March) stays theory when Term 2 isn't configured yet
    assert cells3[30]["period_type"] == "theory"

    # July/August week (week 48: late July) is summer holiday, NOT theory
    assert cells3[48]["period_type"] == "holiday"
    assert cells3[48]["name"] == "Літні канікули"
