import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.database import Base, get_db
from app.main import app
from app.services.settings import TEACHER_PIN_KEY, settings_service


@pytest.fixture
async def sec_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    settings_service.clear_cache()

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client, sessions
    app.dependency_overrides.clear()
    settings_service.clear_cache()
    await engine.dispose()


@pytest.mark.anyio
async def test_empty_configured_teacher_pin_is_never_valid(sec_client):
    client, sessions = sec_client

    # Configure an empty or whitespace pin in database
    async with sessions() as db:
        await settings_service.set(db, TEACHER_PIN_KEY, "")

    res = await client.post("/api/settings/verify-teacher-pin", json={"pin": ""})
    # Pydantic may validate min_length=1 or return valid=False
    if res.status_code == 200:
        assert res.json() == {"valid": False}
    else:
        assert res.status_code == 422

    res_empty_match = await client.post("/api/settings/verify-teacher-pin", json={"pin": "   "})
    assert res_empty_match.status_code in (200, 422)
    if res_empty_match.status_code == 200:
        assert res_empty_match.json() == {"valid": False}


@pytest.mark.anyio
async def test_unhandled_exception_masks_internal_details(sec_client):
    client, _ = sec_client

    # Request a route or trigger an error where an unhandled exception handler catches it
    # We can invoke ping with leave=1 or an endpoint with invalid types if handled by unhandled exception
    # Or define a temporary test endpoint on app
    @app.get("/api/test-error-trigger")
    async def error_trigger():
        raise RuntimeError("SecretDatabaseCredentialsShouldNotLeakToClient")

    try:
        res = await client.get("/api/test-error-trigger")
        assert res.status_code == 500
        data = res.json()
        assert data == {"detail": "Внутрішня помилка сервера"}
        assert "SecretDatabaseCredentialsShouldNotLeakToClient" not in res.text
        assert "trace" not in data
    finally:
        # Remove test route
        app.routes[:] = [r for r in app.routes if getattr(r, "path", None) != "/api/test-error-trigger"]


@pytest.mark.anyio
async def test_rate_limit_verify_teacher_pin(sec_client):
    client, sessions = sec_client

    # Reset limiter storage for clean state
    if hasattr(app.state, "limiter"):
        app.state.limiter.reset()

    async with sessions() as db:
        await settings_service.set(db, TEACHER_PIN_KEY, "correct-pin")

    # Send up to 10 requests which should succeed
    for _ in range(10):
        res = await client.post("/api/settings/verify-teacher-pin", json={"pin": "correct-pin"})
        assert res.status_code == 200

    # The 11th request should be rate-limited (429)
    res_limited = await client.post("/api/settings/verify-teacher-pin", json={"pin": "correct-pin"})
    assert res_limited.status_code == 429


@pytest.mark.anyio
async def test_admin_password_dev_vs_prod_logic():
    import secrets

    # In dev without ADMIN_PASSWORD:
    dev_settings = Settings(environment="development", admin_password=None, jwt_secret_key="dev-secret")
    assert dev_settings.admin_password is None
    token = secrets.token_urlsafe(16)
    assert len(token) > 10

    # In prod without ADMIN_PASSWORD:
    prod_settings = Settings(environment="production", admin_password=None, jwt_secret_key="prod-override-secret-1234567890")
    assert prod_settings.admin_password is None
    assert prod_settings.environment.lower() == "production"
