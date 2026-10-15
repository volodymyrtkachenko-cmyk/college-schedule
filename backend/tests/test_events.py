from datetime import date
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import Group, Faculty, Subject, Teacher, User


@pytest.fixture
async def events_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        faculty = Faculty(name="Факультет")
        session.add(faculty)
        await session.flush()

        group = Group(name="99-1", faculty_id=faculty.id)
        subject = Subject(name="Математика")
        teacher = Teacher(name="Іванов І.І.", room="101")
        admin = User(username="admin", name="Admin", role="admin", password_hash=hash_password("pass"))
        session.add_all([group, subject, teacher, admin])
        await session.commit()
        token = create_access_token(admin)
        data = {
            "group_id": group.id,
            "subject_id": subject.id,
            "teacher_id": teacher.id,
            "token": token,
        }

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, data
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_academic_events_crud(events_client):
    client, data = events_client
    headers = {"Authorization": f"Bearer {data['token']}"}

    # 1. Create event
    payload = {
        "group_id": data["group_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "event_type": "exam",
        "event_date": "2026-06-15",
        "start_time": "09:00",
        "room": "303",
        "note": "Принести заліковку",
    }
    create_resp = await client.post("/api/events", json=payload, headers=headers)
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["title"] == "Математика"
    assert created["event_type"] == "exam"
    event_id = created["id"]

    # 2. List events
    list_resp = await client.get(f"/api/events?group_id={data['group_id']}")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 1
    assert items[0]["id"] == event_id

    # 3. Delete event
    del_resp = await client.delete(f"/api/events/{event_id}", headers=headers)
    assert del_resp.status_code == 200

    # 4. List again is empty
    list_resp2 = await client.get(f"/api/events?group_id={data['group_id']}")
    assert list_resp2.status_code == 200
    assert len(list_resp2.json()) == 0
