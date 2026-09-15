from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from fastapi import HTTPException

from app.core.security import decode_token, hash_password, require_roles, verify_password
from app.database import Base, get_db
from app.main import app
from app.models import User


@pytest.fixture
async def auth_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        session.add(User(username="admin", email="admin@example.test", name="Admin",
                         password_hash=hash_password("correct horse"), role="admin"))
        session.add(User(username="viewer", name="Viewer", password_hash=hash_password("viewer pass")))
        await session.commit()

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
    await engine.dispose()


def test_password_hashing():
    hashed = hash_password("secret")
    assert hashed != "secret"
    assert verify_password("secret", hashed)
    assert not verify_password("wrong", hashed)


@pytest.mark.anyio
async def test_login_me_and_refresh(auth_client):
    login = await auth_client.post("/api/auth/login", json={"username": "admin", "password": "correct horse"})
    assert login.status_code == 200
    tokens = login.json()
    assert tokens["user"]["role"] == "admin"
    assert tokens["access_token"] and tokens["refresh_token"]
    assert "college_schedule_refresh" in login.headers.get("set-cookie", "")
    assert "Path=/" in login.headers.get("set-cookie", "")

    me = await auth_client.get("/api/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 200
    assert me.json()["username"] == "admin"

    refresh = await auth_client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 200
    assert refresh.json()["access_token"] != tokens["access_token"]


@pytest.mark.anyio
async def test_login_access_token_authorizes_admin_endpoint(auth_client):
    login = await auth_client.post("/api/auth/login", json={"username": "admin", "password": "correct horse"})
    token = login.json()["access_token"]
    claims = decode_token(token, "access")
    assert claims["type"] == "access"
    assert claims["role"] == "admin"
    response = await auth_client.get(
        "/api/admin/faculties",
        headers={"Authorization": "B" + "earer " + token},
    )
    assert response.status_code == 200, response.json()


@pytest.mark.anyio
async def test_login_errors_and_roles(auth_client):
    bad_login = await auth_client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert bad_login.status_code == 401
    assert bad_login.json()["detail"] == "Invalid username or password"

    missing_refresh = await auth_client.post("/api/auth/refresh", json={})
    assert missing_refresh.status_code == 401
    assert missing_refresh.json()["detail"] == "Authentication required"

    viewer = User(id=2, username="viewer", name="Viewer", password_hash="hash", role="viewer")
    with pytest.raises(HTTPException) as error:
        await require_roles("admin")(viewer)
    assert error.value.status_code == 403
