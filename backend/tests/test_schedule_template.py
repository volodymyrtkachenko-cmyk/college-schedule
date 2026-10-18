import pytest
from httpx import AsyncClient, ASGITransport
from datetime import date
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import Group, Subject, Teacher, User, ScheduleVersion, Schedule
from app.core.security import create_access_token

@pytest.fixture
async def api_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as session:
        admin_user = User(
            username="admin_user",
            name="Admin",
            password_hash="hash",
            role="admin",
            is_active=True,
        )
        group = Group(name="CS-101", year_of_admission=2024)
        subject = Subject(name="Programming")
        teacher = Teacher(name="Іванов І.І.")
        version = ScheduleVersion(
            name="1 семестр 2026",
            valid_from=date(2026, 9, 1),
            valid_until=date(2027, 1, 31),
            is_active=True,
        )
        session.add_all([admin_user, group, subject, teacher, version])
        await session.commit()
        await session.refresh(admin_user)
        await session.refresh(group)
        await session.refresh(subject)
        await session.refresh(teacher)
        await session.refresh(version)
        admin_id = admin_user.id
        group_id = group.id
        subject_id = subject.id
        teacher_id = teacher.id
        version_id = version.id

    async def get_test_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = get_test_db
    token = create_access_token(admin_user)

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        yield client, {
            "group_id": group_id,
            "subject_id": subject_id,
            "teacher_id": teacher_id,
            "version_id": version_id,
        }

    app.dependency_overrides.clear()
    await engine.dispose()

@pytest.mark.anyio
async def test_schedule_template_crud_and_operations(api_client):
    client, ids = api_client

    # 1. Get initial template (should be empty for group)
    resp = await client.get("/api/schedule/template", params={
        "version_id": ids["version_id"],
        "group_id": ids["group_id"],
        "week_type": "numerator",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["days"]) == 5
    assert all(len(d["lessons"]) == 0 for d in data["days"])

    # 2. Create a template lesson on Monday (day 1, lesson 1)
    create_resp = await client.post("/api/schedule/template/lesson", json={
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "day_of_week": 1,
        "lesson_number": 1,
        "week_type": "numerator",
        "version_id": ids["version_id"],
        "room_override": "101",
    })
    assert create_resp.status_code == 201
    lesson_data = create_resp.json()
    created_id = lesson_data["lesson"]["id"]
    assert lesson_data["lesson"]["subject"] == "Programming"

    # 3. Copy lesson to Tuesday (day 2, lesson 1)
    copy_resp = await client.post("/api/schedule/template/copy", json={
        "version_id": ids["version_id"],
        "source_lesson_id": created_id,
        "target_day_of_week": 2,
        "target_lesson_number": 1,
        "target_week_type": "numerator",
    })
    assert copy_resp.status_code == 200
    copied_data = copy_resp.json()
    copied_id = copied_data["lesson"]["id"]
    assert copied_id != created_id

    # 4. Swap lessons between Monday (1,1) and Tuesday (2,1)
    swap_resp = await client.post("/api/schedule/template/swap", json={
        "version_id": ids["version_id"],
        "first_lesson_id": created_id,
        "second_lesson_id": copied_id,
    })
    assert swap_resp.status_code == 200

    # 5. Move copied lesson from Tuesday (2,1) to Wednesday (3,2)
    move_resp = await client.post("/api/schedule/template/move", json={
        "version_id": ids["version_id"],
        "source_lesson_id": copied_id,
        "target_day_of_week": 3,
        "target_lesson_number": 2,
        "target_week_type": "numerator",
    })
    moved_id = move_resp.json()["lesson"]["id"]

    # 6. Delete lesson
    del_resp = await client.delete(f"/api/schedule/template/lesson/{moved_id}")
    assert del_resp.status_code == 200

    # 7. Check template state
    resp2 = await client.get("/api/schedule/template", params={
        "version_id": ids["version_id"],
        "group_id": ids["group_id"],
        "week_type": "numerator",
    })
    assert resp2.status_code == 200
    items_by_day = {d["day_of_week"]: d["lessons"] for d in resp2.json()["days"]}
    # created_id was swapped to day 2
    assert len(items_by_day[2]) == 1
    assert items_by_day[2][0]["subject"] == "Programming"
