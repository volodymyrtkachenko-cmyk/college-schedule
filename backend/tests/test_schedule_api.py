import pytest
from httpx import AsyncClient, ASGITransport
from datetime import time, date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import Faculty, Group, Schedule, Subject, Teacher, User, BellSchedule
from app.core.security import create_access_token

@pytest.fixture
async def api_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        
    async def override_get_db():
        async with sessions() as session:
            yield session
            
    app.dependency_overrides[get_db] = override_get_db
    
    async with sessions() as session:
        faculty = Faculty(name="Test Faculty")
        subject = Subject(name="Test Subject")
        teacher = Teacher(name="Test Teacher")
        admin = User(username="admin", name="admin", role="admin", password_hash="hash")
        
        session.add_all([faculty, subject, teacher, admin])
        await session.flush()
        
        group = Group(name="Test Group", faculty_id=faculty.id)

        subject2 = Subject(name="Different Subject")
        session.add(subject2)
        group2 = Group(name="Another Group", faculty_id=faculty.id)
        session.add_all([group, group2])
        await session.flush()
        
        bell = BellSchedule(lesson_number=1, start_time=time(9,0), end_time=time(10,20), is_active=True)
        session.add(bell)
        
        sched = Schedule(
            group_id=group.id, subject_id=subject.id, teacher_id=teacher.id,
            day_of_week=1, lesson_number=1, week_type="both", is_active=True
        )
        session.add(sched)
        await session.commit()
        
        token = create_access_token(admin)
        headers = {"Authorization": f"Bearer {token}"}
        
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, headers, {"group_id": group.id, "group2_id": group2.id, "teacher_id": teacher.id, "subject_id": subject.id, "lesson_id": sched.id}
            
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_schedule_week_returns_200_and_time(api_client):
    client, _, data = api_client
    resp = await client.get(f"/api/schedule/week?group_id={data['group_id']}&target_date=2025-09-01")
    assert resp.status_code == 200
    days = resp.json()
    assert len(days) > 0
    assert days[0]["lessons"][0]["time"] == "09:00-10:20"

@pytest.mark.anyio
async def test_schedule_teacher_conflict_gives_409(api_client):
    client, headers, data = api_client
    # Try to schedule another group at same time with same teacher, BUT DIFFERENT subject
    payload = {
        "group_id": data["group2_id"],
        "subject": "Different Subject",
        "teacher_id": data["teacher_id"],
        "day_of_week": 1,
        "lesson_number": 1,
        "week_type": "both"
    }
    resp = await client.post("/api/schedule", json=payload, headers=headers)
    assert resp.status_code == 409
    assert "Викладач уже веде заняття" in resp.json()["detail"]

@pytest.mark.anyio
async def test_schedule_teacher_conflict_bypassed_if_same_subject(api_client):
    client, headers, data = api_client
    # "Потік": same teacher, same subject, same time slot, different group
    payload = {
        "group_id": data["group2_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "day_of_week": 1,
        "lesson_number": 1,
        "week_type": "both"
    }
    resp = await client.post("/api/schedule", json=payload, headers=headers)
    assert resp.status_code == 201

@pytest.mark.anyio
async def test_schedule_invalid_lesson_numbers(api_client):
    client, headers, data = api_client
    payload = {
        "group_id": data["group2_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "day_of_week": 1,
        "week_type": "both"
    }
    # lesson 0
    resp = await client.post("/api/schedule", json={**payload, "lesson_number": 0}, headers=headers)
    assert resp.status_code == 422
    # lesson 5
    resp = await client.post("/api/schedule", json={**payload, "lesson_number": 5}, headers=headers)
    assert resp.status_code == 422

@pytest.mark.anyio
async def test_patch_room_override(api_client):
    client, headers, data = api_client
    # Patch with room "205"
    resp = await client.patch(f"/api/schedule/{data['lesson_id']}", json={"room": "205"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["room"] == "205"
    
    # Patch with null
    resp = await client.patch(f"/api/schedule/{data['lesson_id']}", json={"room": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["room"] not in ("205",) # Probably null or fallback
