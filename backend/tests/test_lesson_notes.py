from datetime import date, time

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import Faculty, Group, Schedule, Subject, User


@pytest.fixture
async def notes_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        faculty = Faculty(name="Notes Faculty")
        subject = Subject(name="Notes Subject")
        admin = User(
            username="notes-admin", name="Admin",
            password_hash=hash_password("password"), role="admin",
        )
        viewer = User(
            username="notes-viewer", name="Viewer",
            password_hash=hash_password("password"), role="viewer",
        )
        session.add_all([faculty, subject, admin, viewer])
        await session.flush()
        group = Group(name="Notes Group", faculty_id=faculty.id)
        session.add(group)
        await session.flush()
        lesson = Schedule(
            group_id=group.id, subject_id=subject.id, day_of_week=1,
            lesson_number=1, start_time=time(9), end_time=time(10),
            week_type="both",
        )
        session.add(lesson)
        await session.commit()
        admin_token = create_access_token(admin)
        viewer_token = create_access_token(viewer)
        lesson_id = lesson.id

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, lesson_id, admin_token, viewer_token
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_lesson_note_crud_and_mutation_auth(notes_client):
    client, lesson_id, admin_token, viewer_token = notes_client
    admin = {"Authorization": f"Bearer {admin_token}"}
    viewer = {"Authorization": f"Bearer {viewer_token}"}
    payload = {"schedule_id": lesson_id, "note_date": "2025-09-01", "note": "Bring handouts"}

    assert (await client.post("/api/lesson-notes", json=payload)).status_code == 401
    assert (await client.post("/api/lesson-notes", json=payload, headers=viewer)).status_code == 403
    created = await client.post("/api/lesson-notes", json=payload, headers=admin)
    assert created.status_code == 201
    note_id = created.json()["id"]
    assert (await client.get(f"/api/lesson-notes/{note_id}")).json()["note"] == "Bring handouts"
    assert (await client.patch(
        f"/api/lesson-notes/{note_id}", json={"note": "Updated"}, headers=admin
    )).status_code == 200
    assert (await client.delete(f"/api/lesson-notes/{note_id}", headers=viewer)).status_code == 403
    assert (await client.delete(f"/api/lesson-notes/{note_id}", headers=admin)).status_code == 204


@pytest.mark.anyio
async def test_lesson_note_list_filters_date(notes_client):
    client, lesson_id, admin_token, _ = notes_client
    headers = {"Authorization": f"Bearer {admin_token}"}
    for note_date in ("2025-09-01", "2025-09-08"):
        response = await client.post(
            "/api/lesson-notes",
            json={"schedule_id": lesson_id, "note_date": note_date, "note": note_date},
            headers=headers,
        )
        assert response.status_code == 201
    response = await client.get("/api/lesson-notes?note_date=2025-09-01")
    assert [item["note"] for item in response.json()] == ["2025-09-01"]
