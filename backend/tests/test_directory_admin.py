import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import User


@pytest.fixture
async def directory_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        admin = User(username="directory-admin", name="Admin", role="admin", password_hash=hash_password("pass"))
        viewer = User(username="directory-viewer", name="Viewer", role="viewer", password_hash=hash_password("pass"))
        editor = User(username="directory-editor", name="Editor", role="editor", password_hash=hash_password("pass"))
        session.add_all([admin, viewer, editor])
        await session.commit()
        tokens = {u.role: create_access_token(u) for u in (admin, viewer, editor)}

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, {role: {"Authorization": f"Bearer {token}"} for role, token in tokens.items()}
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_all_directory_resources_crud_and_soft_delete(directory_client):
    client, headers = directory_client
    payloads = {
        "faculties": {"name": "Engineering", "short_name": "ENG"},
        "groups": {"name": "G-1", "faculty_id": None},
        "teachers": {"name": "Ada"},
        "rooms": {"name": "101", "capacity": 30},
        "subjects": {"name": "Algorithms", "short_name": "ALG"},
    }
    ids = {}
    for resource, payload in payloads.items():
        created = await client.post(f"/api/{resource}", json=payload, headers=headers["admin"])
        assert created.status_code == 201
        ids[resource] = created.json()["id"]
        assert (await client.get(f"/api/{resource}")).status_code == 200
    updated = await client.patch(f"/api/teachers/{ids['teachers']}", json={"name": "Grace"}, headers=headers["admin"])
    assert updated.status_code == 200
    assert (await client.delete(f"/api/teachers/{ids['teachers']}", headers=headers["admin"])).status_code == 204
    assert all(item["id"] != ids["teachers"] for item in (await client.get("/api/teachers")).json())


@pytest.mark.anyio
async def test_directory_mutations_are_admin_only_and_validate_duplicates_and_fk(directory_client):
    client, headers = directory_client
    assert (await client.post("/api/rooms", json={"name": "101"}, headers=headers["viewer"])).status_code == 403
    assert (await client.post("/api/rooms", json={"name": "101"}, headers=headers["editor"])).status_code == 403
    assert (await client.post("/api/rooms", json={"name": "101"}, headers=headers["admin"])).status_code == 201
    assert (await client.post("/api/rooms", json={"name": "101"}, headers=headers["admin"])).status_code == 409
    invalid = await client.post("/api/groups", json={"name": "G", "faculty_id": 999}, headers=headers["admin"])
    assert invalid.status_code == 422
    malformed = await client.post("/api/rooms", json={"name": "R", "capacity": -1}, headers=headers["admin"])
    assert malformed.status_code == 422


@pytest.mark.anyio
async def test_admin_reference_routes_require_admin_and_return_active_records(directory_client):
    client, headers = directory_client
    for resource in ("faculties", "groups", "teachers", "rooms", "subjects"):
        assert (await client.get(f"/api/admin/{resource}")).status_code == 401
        assert (await client.get(f"/api/admin/{resource}", headers=headers["viewer"])).status_code == 403
        response = await client.get(f"/api/admin/{resource}", headers=headers["admin"])
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    created = await client.post(
        "/api/admin/subjects", json={"name": "Admin Subject"}, headers=headers["admin"]
    )
    assert created.status_code == 201
    deleted = await client.delete(
        f"/api/admin/subjects/{created.json()['id']}", headers=headers["admin"]
    )
    assert deleted.status_code == 204
    active = await client.get("/api/admin/subjects", headers=headers["admin"])
    assert all(item["id"] != created.json()["id"] for item in active.json())
