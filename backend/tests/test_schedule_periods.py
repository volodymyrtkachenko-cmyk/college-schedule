from datetime import date, time

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token
from app.database import Base, get_db
from app.main import app
from app.models import (
    BellSchedule,
    Faculty,
    Group,
    Schedule,
    SchedulePeriod,
    SchedulePeriodSlot,
    Subject,
    Teacher,
    TeacherConstraint,
    User,
)


@pytest.fixture
async def calendar_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with sessions() as session:
        faculty = Faculty(name="Calendar faculty")
        subject = Subject(name="Regular subject")
        practice_subject = Subject(name="Practice subject")
        regular_teacher = Teacher(name="Regular teacher")
        practice_teacher = Teacher(name="Practice teacher")
        admin = User(username="calendar-admin", name="Admin", role="admin", password_hash="hash")
        session.add_all([faculty, subject, practice_subject, regular_teacher, practice_teacher, admin])
        await session.flush()
        group = Group(name="Practice group", faculty_id=faculty.id)
        other_group = Group(name="Other group", faculty_id=faculty.id)
        session.add_all([group, other_group])
        await session.flush()
        session.add_all([
            BellSchedule(lesson_number=1, start_time=time(9, 0), end_time=time(10, 20), is_active=True),
            BellSchedule(lesson_number=2, start_time=time(10, 40), end_time=time(12, 0), is_active=True),
            BellSchedule(lesson_number=3, start_time=time(12, 30), end_time=time(13, 50), is_active=True),
            Schedule(
                group_id=group.id, subject_id=subject.id, teacher_id=regular_teacher.id,
                day_of_week=1, lesson_number=1, week_type="both", is_active=True,
            ),
            Schedule(
                group_id=other_group.id, subject_id=subject.id, teacher_id=practice_teacher.id,
                day_of_week=1, lesson_number=1, week_type="both", is_active=True,
            ),
        ])
        await session.commit()
        ids = {
            "group": group.id,
            "other_group": other_group.id,
            "subject": subject.id,
            "practice_subject": practice_subject.id,
            "regular_teacher": regular_teacher.id,
            "practice_teacher": practice_teacher.id,
        }
        headers = {"Authorization": f"Bearer {create_access_token(admin)}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, headers, ids, sessions
    app.dependency_overrides.clear()
    await engine.dispose()


def practice_payload(ids):
    return {
        "name": "Practice session",
        "period_type": "practice",
        "start_date": "2026-10-05",
        "end_date": "2026-10-16",
        "group_ids": [ids["group"]],
        "slots": [
            {
                "group_id": ids["group"],
                "subject_id": ids["practice_subject"],
                "teacher_id": ids["practice_teacher"],
                "day_of_week": 1,
                "lesson_number": 2,
            },
            {
                "group_id": ids["group"],
                "subject_id": ids["practice_subject"],
                "teacher_id": ids["practice_teacher"],
                "day_of_week": 5,
                "lesson_number": 3,
            },
        ],
    }


@pytest.mark.anyio
async def test_practice_replaces_selected_group_and_restores_regular_schedule(calendar_client):
    client, headers, ids, _ = calendar_client
    created = await client.post("/api/calendar-periods/", json=practice_payload(ids), headers=headers)
    assert created.status_code == 201, created.text

    first_day = await client.get(
        f"/api/schedule?group_id={ids['group']}&target_date=2026-10-05"
    )
    assert first_day.status_code == 200
    assert [(lesson["subject_name"], lesson["is_replacement"]) for lesson in first_day.json()["lessons"]] == [
        ("Practice subject", True)
    ]

    week = await client.get(
        f"/api/schedule/week?group_id={ids['group']}&target_date=2026-10-05"
    )
    assert week.status_code == 200
    assert [lesson["subject_name"] for lesson in week.json()[0]["lessons"]] == ["Practice subject"]
    assert week.json()[1]["lessons"] == []
    assert [lesson["subject_name"] for lesson in week.json()[4]["lessons"]] == ["Practice subject"]

    last_day = await client.get(
        f"/api/schedule?group_id={ids['group']}&target_date=2026-10-16"
    )
    assert [lesson["subject_name"] for lesson in last_day.json()["lessons"]] == ["Practice subject"]

    after_period = await client.get(
        f"/api/schedule?group_id={ids['group']}&target_date=2026-10-19"
    )
    assert [lesson["subject_name"] for lesson in after_period.json()["lessons"]] == ["Regular subject"]

    unaffected_group = await client.get(
        f"/api/schedule?group_id={ids['other_group']}&target_date=2026-10-05"
    )
    assert [lesson["subject_name"] for lesson in unaffected_group.json()["lessons"]] == ["Regular subject"]


@pytest.mark.anyio
async def test_teacher_filter_includes_practice_and_unaffected_regular_lessons(calendar_client):
    client, headers, ids, _ = calendar_client
    response = await client.post("/api/calendar-periods/", json=practice_payload(ids), headers=headers)
    assert response.status_code == 201, response.text

    schedule = await client.get(
        f"/api/schedule?teacher_id={ids['practice_teacher']}&target_date=2026-10-05"
    )
    assert [(lesson["group_name"], lesson["subject_name"]) for lesson in schedule.json()["lessons"]] == [
        ("Other group", "Regular subject"),
        ("Practice group", "Practice subject"),
    ]


@pytest.mark.anyio
async def test_holiday_takes_precedence_over_practice(calendar_client):
    client, headers, ids, _ = calendar_client
    practice = await client.post("/api/calendar-periods/", json=practice_payload(ids), headers=headers)
    assert practice.status_code == 201, practice.text
    holiday = await client.post(
        "/api/calendar-periods/",
        json={
            "name": "Autumn holiday",
            "period_type": "holiday",
            "start_date": "2026-10-05",
            "end_date": "2026-10-06",
        },
        headers=headers,
    )
    assert holiday.status_code == 201, holiday.text

    schedule = await client.get(
        f"/api/schedule?group_id={ids['group']}&target_date=2026-10-05"
    )
    assert schedule.status_code == 200
    assert schedule.json()["lessons"] == []


@pytest.mark.anyio
async def test_holiday_only_hides_selected_groups(calendar_client):
    client, headers, ids, _ = calendar_client
    holiday = await client.post(
        "/api/calendar-periods/",
        json={
            "name": "Session break",
            "period_type": "holiday",
            "start_date": "2026-10-05",
            "end_date": "2026-10-09",
            "group_ids": [ids["group"]],
        },
        headers=headers,
    )
    assert holiday.status_code == 201, holiday.text
    assert [group["id"] for group in holiday.json()["groups"]] == [ids["group"]]

    selected_group_schedule = await client.get(
        f"/api/schedule?group_id={ids['group']}&target_date=2026-10-05"
    )
    assert selected_group_schedule.status_code == 200
    assert selected_group_schedule.json()["lessons"] == []

    other_group_schedule = await client.get(
        f"/api/schedule?group_id={ids['other_group']}&target_date=2026-10-05"
    )
    assert [lesson["group_name"] for lesson in other_group_schedule.json()["lessons"]] == ["Other group"]

    full_schedule = await client.get("/api/schedule?target_date=2026-10-05")
    assert [lesson["group_name"] for lesson in full_schedule.json()["lessons"]] == ["Other group"]


@pytest.mark.anyio
async def test_practice_rejects_regular_teacher_conflict_and_overlapping_group_period(calendar_client):
    client, headers, ids, _ = calendar_client
    payload = practice_payload(ids)
    payload["slots"][0]["teacher_id"] = ids["practice_teacher"]
    payload["slots"][0]["day_of_week"] = 1
    payload["slots"][0]["lesson_number"] = 1
    conflict = await client.post("/api/calendar-periods/", json=payload, headers=headers)
    assert conflict.status_code == 409

    created = await client.post("/api/calendar-periods/", json=practice_payload(ids), headers=headers)
    assert created.status_code == 201, created.text
    overlapping = practice_payload(ids)
    overlapping["name"] = "Overlapping practice"
    overlapping["start_date"] = "2026-10-10"
    overlap_response = await client.post("/api/calendar-periods/", json=overlapping, headers=headers)
    assert overlap_response.status_code == 409


@pytest.mark.anyio
async def test_practice_rejects_hard_teacher_unavailability(calendar_client):
    client, headers, ids, sessions = calendar_client
    async with sessions() as session:
        session.add(TeacherConstraint(
            teacher_id=ids["practice_teacher"],
            day_of_week=2,
            lesson_number=1,
            is_hard_constraint=True,
        ))
        await session.commit()

    payload = practice_payload(ids)
    payload["slots"].append({
        "group_id": ids["group"],
        "subject_id": ids["practice_subject"],
        "teacher_id": ids["practice_teacher"],
        "day_of_week": 2,
        "lesson_number": 1,
    })
    response = await client.post("/api/calendar-periods/", json=payload, headers=headers)
    assert response.status_code == 409
    assert "недоступний" in response.json()["detail"]


@pytest.mark.anyio
async def test_period_crud_and_invalid_dates(calendar_client):
    client, headers, ids, sessions = calendar_client
    invalid = practice_payload(ids)
    invalid["start_date"], invalid["end_date"] = "2026-10-17", "2026-10-16"
    assert (await client.post("/api/calendar-periods/", json=invalid, headers=headers)).status_code == 422

    created = await client.post("/api/calendar-periods/", json=practice_payload(ids), headers=headers)
    period_id = created.json()["id"]
    listed = await client.get("/api/calendar-periods/", headers=headers)
    assert [item["id"] for item in listed.json()] == [period_id]

    updated = practice_payload(ids)
    updated["name"] = "Updated practice"
    updated_response = await client.put(f"/api/calendar-periods/{period_id}", json=updated, headers=headers)
    assert updated_response.status_code == 200
    assert updated_response.json()["name"] == "Updated practice"

    deleted = await client.delete(f"/api/calendar-periods/{period_id}", headers=headers)
    assert deleted.status_code == 204
    async with sessions() as session:
        assert await session.get(SchedulePeriod, period_id) is None
        assert (await session.scalars(select(SchedulePeriodSlot))).all() == []
