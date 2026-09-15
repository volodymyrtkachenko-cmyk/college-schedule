from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import Setting, User
from app.services.settings import SEMESTER_START_KEY, settings_service


@pytest.fixture
async def settings_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        users = [
            User(username="settings-admin", name="Admin", password_hash=hash_password("pass"), role="admin"),
            User(username="settings-editor", name="Editor", password_hash=hash_password("pass"), role="editor"),
            User(username="settings-viewer", name="Viewer", password_hash=hash_password("pass"), role="viewer"),
        ]
        session.add_all(users)
        await session.commit()
        tokens = {user.role: create_access_token(user) for user in users}

    settings_service.clear_cache()

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, tokens, sessions
    app.dependency_overrides.clear()
    settings_service.clear_cache()
    await engine.dispose()


@pytest.mark.anyio
async def test_public_get_returns_fallback_when_setting_is_missing(settings_client):
    client, _, _ = settings_client
    response = await client.get("/api/settings/semester-start")
    assert response.status_code == 200
    assert response.json() == {"value": "2025-09-01"}


@pytest.mark.anyio
async def test_admin_put_and_cache_invalidation(settings_client):
    client, tokens, sessions = settings_client
    admin = {"Authorization": f"Bearer {tokens['admin']}"}

    first = await client.get("/api/settings/semester-start")
    assert first.json()["value"] == "2025-09-01"
    updated = await client.put(
        "/api/settings/semester-start",
        json={"value": "2025-09-08"},
        headers=admin,
    )
    assert updated.status_code == 200
    assert updated.json() == {"value": "2025-09-08"}

    async with sessions() as db:
        stored = await db.get(Setting, SEMESTER_START_KEY)
        assert stored.value == "2025-09-08"
    assert (await client.get("/api/settings/semester-start")).json()["value"] == "2025-09-08"


@pytest.mark.anyio
async def test_viewer_and_editor_cannot_update(settings_client):
    client, tokens, _ = settings_client
    payload = {"value": "2025-09-08"}
    for role in ("viewer", "editor"):
        response = await client.put(
            "/api/settings/semester-start",
            json=payload,
            headers={"Authorization": f"Bearer {tokens[role]}"},
        )
        assert response.status_code == 403


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("value", "detail"),
    [
        ("not-a-date", None),
        ("2025-09-02", "semester_start must be a Monday"),
    ],
)
async def test_invalid_semester_start_is_rejected(settings_client, value, detail):
    client, tokens, _ = settings_client
    response = await client.put(
        "/api/settings/semester-start",
        json={"value": value},
        headers={"Authorization": f"Bearer {tokens['admin']}"},
    )
    assert response.status_code == 422
    if detail:
        assert response.json()["detail"] == detail
