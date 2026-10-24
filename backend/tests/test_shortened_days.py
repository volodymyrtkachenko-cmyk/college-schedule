from datetime import time
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import BellSchedule, Group, Schedule, Subject, Teacher, User
from app.services.settings import settings_service


@pytest.fixture
async def shortened_test_setup():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as session:
        admin_user = User(username="admin", name="Admin", password_hash=hash_password("pass"), role="admin")
        viewer_user = User(username="viewer", name="Viewer", password_hash=hash_password("pass"), role="viewer")
        session.add_all([admin_user, viewer_user])

        group = Group(name="85 ДФКР")
        teacher = Teacher(name="Іванов І.І.")
        subject = Subject(name="Комп'ютерні мережі")
        session.add_all([group, teacher, subject])
        await session.flush()

        bell1 = BellSchedule(lesson_number=1, start_time=time(9, 0), end_time=time(10, 20), is_active=True)
        bell2 = BellSchedule(lesson_number=2, start_time=time(10, 40), end_time=time(12, 0), is_active=True)
        session.add_all([bell1, bell2])

        sched1 = Schedule(
            group_id=group.id,
            subject_id=subject.id,
            teacher_id=teacher.id,
            day_of_week=3,  # Wednesday
            lesson_number=1,
            week_type="both",
            is_active=True,
        )
        sched2 = Schedule(
            group_id=group.id,
            subject_id=subject.id,
            teacher_id=teacher.id,
            day_of_week=3,  # Wednesday
            lesson_number=2,
            week_type="both",
            is_active=True,
        )
        session.add_all([sched1, sched2])
        await session.commit()

        admin_token = create_access_token(admin_user)
        viewer_token = create_access_token(viewer_user)
        group_id = group.id

    settings_service.clear_cache()

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, admin_token, viewer_token, group_id, sessions

    app.dependency_overrides.clear()
    settings_service.clear_cache()
    await engine.dispose()


@pytest.mark.anyio
async def test_shortened_days_settings_crud(shortened_test_setup):
    client, admin_token, viewer_token, _, _ = shortened_test_setup
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

    # 1. Initial list is empty
    resp = await client.get("/api/settings/shortened-days")
    assert resp.status_code == 200
    assert resp.json() == []

    # 2. Add shortened day
    payload = {"date": "2026-10-28", "reason": "Передсвятковий день"}
    # Viewer cannot add
    resp = await client.post("/api/settings/shortened-days", json=payload, headers=viewer_headers)
    assert resp.status_code == 403

    # Admin can add
    resp = await client.post("/api/settings/shortened-days", json=payload, headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["date"] == "2026-10-28"
    assert data[0]["reason"] == "Передсвятковий день"

    # 3. Toggle off
    resp = await client.post("/api/settings/shortened-days/toggle", json={"date": "2026-10-28"}, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["is_shortened"] is False

    # Check list is now empty
    resp = await client.get("/api/settings/shortened-days")
    assert resp.json() == []

    # 4. Toggle on
    resp = await client.post("/api/settings/shortened-days/toggle", json={"date": "2026-10-28", "reason": "Педрада"}, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["is_shortened"] is True

    # 5. Delete by date
    resp = await client.delete("/api/settings/shortened-days/2026-10-28", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.anyio
async def test_schedule_times_on_shortened_days(shortened_test_setup):
    client, admin_token, _, group_id, _ = shortened_test_setup
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    target_date = "2026-10-28"  # Wednesday

    # Regular day schedule check
    resp = await client.get(f"/api/schedule?group_id={group_id}&target_date={target_date}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_shortened_day"] is False
    assert len(data["lessons"]) == 2
    assert data["lessons"][0]["time"] == "09:00-10:20"
    assert data["lessons"][1]["time"] == "10:40-12:00"

    # Enable shortened day
    await client.post(
        "/api/settings/shortened-days",
        json={"date": target_date, "reason": "Скорочений день"},
        headers=admin_headers,
    )

    # Now verify day schedule has shortened bell times
    resp = await client.get(f"/api/schedule?group_id={group_id}&target_date={target_date}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_shortened_day"] is True
    assert len(data["lessons"]) == 2
    assert data["lessons"][0]["time"] == "09:00-09:50"
    assert data["lessons"][1]["time"] == "10:00-10:50"

    # Verify week schedule
    monday_date = "2026-10-26"
    resp = await client.get(f"/api/schedule/week?group_id={group_id}&target_date={monday_date}")
    assert resp.status_code == 200
    week_data = resp.json()
    # Wednesday is index 2
    wednesday = next(d for d in week_data if d["date"] == target_date)
    assert wednesday["is_shortened_day"] is True
    assert wednesday["lessons"][0]["time"] == "09:00-09:50"

    # Monday is regular
    monday = next(d for d in week_data if d["date"] == monday_date)
    assert monday["is_shortened_day"] is False


@pytest.mark.anyio
async def test_copy_day_via_batch_endpoint(shortened_test_setup):
    client, admin_token, _, group_id, _ = shortened_test_setup
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    source_date = "2026-10-28"
    target_date = "2026-10-29"

    # Batch copy day
    batch_payload = {
        "action": "copy",
        "items": [
            {
                "source_group_id": group_id,
                "source_date": source_date,
                "source_lesson_number": 1,
                "target_group_id": group_id,
                "target_date": target_date,
                "target_lesson_number": 1,
            },
            {
                "source_group_id": group_id,
                "source_date": source_date,
                "source_lesson_number": 2,
                "target_group_id": group_id,
                "target_date": target_date,
                "target_lesson_number": 2,
            },
        ],
        "skip_conflicts": True,
    }
    resp = await client.post("/api/schedule/dated/batch", json=batch_payload, headers=admin_headers)
    assert resp.status_code == 200
    result = resp.json()
    assert result["succeeded"] == 2

    # Check target date now has lessons
    resp = await client.get(f"/api/schedule?group_id={group_id}&target_date={target_date}")
    assert resp.status_code == 200
    target_data = resp.json()
    assert len(target_data["lessons"]) == 2

    # Check source date STILL has lessons (because it was copied, not moved)
    resp = await client.get(f"/api/schedule?group_id={group_id}&target_date={source_date}")
    assert resp.status_code == 200
    source_data = resp.json()
    assert len(source_data["lessons"]) == 2
