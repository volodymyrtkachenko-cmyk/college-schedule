import os
from datetime import date, time
from unittest.mock import patch
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.core import crypto
from app.core.security import create_access_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import (
    BellSchedule,
    Faculty,
    Group,
    ImportedScheduleChange,
    Schedule,
    ScheduleVersion,
    Subject,
    Teacher,
    User,
)
from app.models.entities import SchedulePublication


@pytest.fixture
async def block1_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with sessions() as db:
        fac = Faculty(id=1, name="КІ", short_name="КІ")
        g1 = Group(id=85, name="85", faculty_id=1)
        t1 = Teacher(id=1, name="Іванов І.І.", room="https://zoom.us/j/123456789?pwd=secret")
        s1 = Subject(id=1, name="Комп'ютерна схемотехніка")
        v1 = ScheduleVersion(
            id=1,
            name="Основний",
            valid_from=date(2025, 9, 1),
            valid_until=date(2027, 6, 30),
            is_active=True,
        )
        bell = BellSchedule(
            lesson_number=1,
            start_time=time(9, 0),
            end_time=time(10, 20),
            is_active=True,
        )
        sched = Schedule(
            id=1,
            version_id=1,
            group_id=85,
            subject_id=1,
            teacher_id=1,
            day_of_week=1,
            lesson_number=1,
            week_type="both",
            room_override="https://meet.google.com/abc-defg-hij",
            is_active=True,
        )
        admin = User(
            id=1,
            username="admin",
            name="Admin",
            password_hash=hash_password("admin-secret-pass"),
            role="admin",
            is_active=True,
        )
        pub = SchedulePublication(
            id=77,
            version_id=1,
            scope_manifest='{"source": "auto", "changes_count": 1}',
            is_reverted=False,
        )
        imp_change = ImportedScheduleChange(
            id=88,
            publication_id=77,
            date=date(2026, 10, 19),
            kind="substitution",
            change_type="swap",
            group_id=85,
            subject_id=1,
            teacher_id=1,
            lesson_number=1,
            is_published=True,
        )
        db.add_all([fac, g1, t1, s1, v1, bell, sched, admin, pub, imp_change])
        await db.commit()
        admin_token = create_access_token(admin)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client, admin_token
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_finding_2_has_access_query_param_cannot_bypass_guest_sanitization(block1_client):
    client, _ = block1_client
    res = await client.get("/api/schedule?group_id=85&target_date=2026-10-19&has_access=true")
    assert res.status_code == 200
    lessons = res.json()["lessons"]
    assert len(lessons) == 1
    assert "meet.google.com" not in (lessons[0].get("room") or "")
    assert "zoom.us" not in (lessons[0].get("teacher_room") or "")
    assert lessons[0]["has_protected_link"] is True


def test_finding_3_admin_password_default_and_production_validator():
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("ADMIN_PASSWORD", None)
        s = Settings(_env_file=None, environment="development", jwt_secret_key="dev-secret")
        assert s.admin_password is None

    with pytest.raises(ValueError, match="admin123"):
        Settings(
            _env_file=None,
            environment="production",
            jwt_secret_key="strong-prod-jwt-secret-key-999",
            admin_password="admin123",
        )

    # Hardcoded fallback key is no longer in primary encryption candidates
    source_names = [name for name, _ in crypto._candidate_key_sources()]
    assert "fallback_default" not in source_names


@pytest.mark.anyio
async def test_finding_9_attribute_errors_resolved(block1_client):
    client, admin_token = block1_client

    # 1. ImportedScheduleChange.is_same_day_swap in /api/schedule-versions/publications/{id}/changes
    res_changes = await client.get(
        "/api/schedule-versions/publications/77/changes",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res_changes.status_code == 200
    data = res_changes.json()
    assert len(data) == 1
    assert data[0]["is_swap"] is True
    assert data[0]["change_type"] == "swap"

    # 2. settings.wipe_secret in /api/classroom/clear-all-data returns 403 instead of 500 AttributeError
    res_wipe = await client.post("/api/classroom/clear-all-data?wipe_secret=wrong")
    assert res_wipe.status_code == 403


@pytest.mark.anyio
async def test_finding_10_metrics_protected_and_query_token_rejected(block1_client):
    client, admin_token = block1_client

    # Unauthenticated /api/metrics must return 401
    r_unauth = await client.get("/api/metrics")
    assert r_unauth.status_code == 401

    # Query param ?token= must NOT authenticate staff presence on /api/ping
    await client.get(f"/api/ping?sid=spoof_tab&role=admin&u=spoofed_admin&token={admin_token}")

    r_auth = await client.get(
        "/api/metrics",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_auth.status_code == 200
    staff_usernames = [s.get("username") for s in r_auth.json()["online_details"]["staff"]]
    assert "spoofed_admin" not in staff_usernames


@pytest.mark.anyio
async def test_finding_10_rate_limit_ignores_spoofed_xff_when_untrusted(block1_client):
    from app.core.rate_limit import get_real_client_ip
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/auth/login",
        "headers": [(b"x-forwarded-for", b"1.2.3.4, 5.6.7.8")],
        "client": ("198.51.100.25", 54321),
    }
    req = Request(scope)
    with patch.dict(os.environ, {"FORWARDED_ALLOW_IPS": "127.0.0.1"}, clear=False):
        os.environ.pop("DYNO", None)
        assert get_real_client_ip(req) == "198.51.100.25"

    with patch.dict(os.environ, {"DYNO": "web.1"}, clear=False):
        # Behind Heroku router, rightmost IP is used, ignoring client-prepended 1.2.3.4
        assert get_real_client_ip(req) == "5.6.7.8"
