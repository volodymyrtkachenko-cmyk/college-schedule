import logging
from unittest.mock import patch
import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.core.crypto import encrypt_token
from app.core.security import create_classroom_session_token, verify_classroom_session_token
from app.database import Base, get_db
from app.main import app
from app.models import ClassroomCredential, Group, GroupStudent


@pytest.mark.anyio
async def test_finding_1_and_6_classroom_session_token_and_legacy_auth_switch(caplog, monkeypatch):
    """
    #1 & #6:
    a) Identity verified via Google (userinfo/userProfiles) or signed classroom_session_token;
    b) Google access_token is no longer returned from /api/classroom/user-submissions;
    c) Legacy auth (email, google_user_id, X-Classroom-Email) works when CLASSROOM_LEGACY_AUTH=true
       with WARNING log, and is rejected when CLASSROOM_LEGACY_AUTH=false;
    d) Identity mismatch between Google access_token and claimed email/uid is rejected.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    tok_prefix = "y" + "a29."
    rt_prefix = "1" + "//"
    valid_tok = tok_prefix + "student_valid"
    other_tok = tok_prefix + "other_user_token"

    async with sessions() as session:
        group = Group(name="CS-101", is_active=True)
        session.add(group)
        await session.flush()
        group_id = group.id

        cred = ClassroomCredential(
            group_id=group_id,
            google_user_id="uid_verified_101",
            email="student101@example.test",
            student_name="Студент 101",
            refresh_token=encrypt_token(rt_prefix + "rt_student_101"),
            is_active=True,
        )
        student = GroupStudent(
            group_id=group_id,
            classroom_user_id="uid_verified_101",
            full_name="Студент 101",
            email="student101@example.test",
        )
        session.add_all([cred, student])
        await session.commit()

    async def override_get_db():
        async with sessions() as session:
            yield session

    def fake_google_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        auth = request.headers.get("Authorization", "")
        tok = auth.replace("Bearer ", "").strip()
        if "oauth2/v3/userinfo" in url:
            if tok == valid_tok:
                return httpx.Response(
                    200,
                    json={
                        "sub": "uid_verified_101",
                        "email": "student101@example.test",
                        "name": "Студент 101",
                    },
                )
            if tok == other_tok:
                return httpx.Response(
                    200,
                    json={
                        "sub": "uid_other_999",
                        "email": "other999@example.test",
                    },
                )
            return httpx.Response(401, json={"error": "invalid_token"})
        if "/v1/courses" in url and "courseWork" not in url:
            return httpx.Response(
                200,
                json={"courses": [{"id": "c101", "name": "Програмування CS-101"}]},
            )
        if "/teachers" in url:
            return httpx.Response(200, json={"teachers": []})
        if "/topics" in url:
            return httpx.Response(200, json={"topic": []})
        if "/studentSubmissions" in url:
            return httpx.Response(
                200,
                json={"studentSubmissions": [{"courseWorkId": "cw1", "state": "TURNED_IN", "assignedGrade": 12}]},
            )
        if "/courseWork" in url:
            return httpx.Response(
                200,
                json={
                    "courseWork": [
                        {
                            "id": "cw1",
                            "title": "Лабораторна №1",
                            "alternateLink": "http://test/c/c101/a/cw1/details",
                            "maxPoints": 12,
                        }
                    ]
                },
            )
        if "oauth2.googleapis.com/revoke" in url:
            return httpx.Response(200, json={})
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(fake_google_handler)
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    async def fake_refresh(_rt: str):
        return valid_tok, None, 200

    app.dependency_overrides[get_db] = override_get_db
    try:
        with (
            patch("app.services.classroom.sync.httpx.AsyncClient", side_effect=mocked_client),
            patch("app.services.classroom.tokens._refresh_google_token_detailed", side_effect=fake_refresh),
        ):
            asgi_transport = ASGITransport(app=app)
            async with AsyncClient(transport=asgi_transport, base_url="http://test") as client:
                # 1. Verify signed token creation & tamper rejection
                signed_tok = create_classroom_session_token(
                    google_user_id="uid_verified_101",
                    email="student101@example.test",
                    group_id=group_id,
                )
                parsed = verify_classroom_session_token(signed_tok)
                assert parsed is not None
                assert parsed["google_user_id"] == "uid_verified_101"
                assert parsed["email"] == "student101@example.test"
                assert verify_classroom_session_token(signed_tok + "invalid") is None

                # 2. Legacy auth enabled (default True): works but logs WARNING, and does NOT leak access_token
                monkeypatch.setattr(settings, "classroom_legacy_auth", True)
                caplog.clear()
                with caplog.at_level(logging.WARNING):
                    legacy_sub = await client.post(
                        "/api/classroom/user-submissions",
                        json={"group_id": group_id, "email": "student101@example.test"},
                    )
                assert legacy_sub.status_code == 200
                sub_body = legacy_sub.json()
                assert sub_body["connected"] is True
                assert "access_token" not in sub_body
                assert sub_body.get("session_token")
                assert any("legacy auth used" in rec.message.lower() for rec in caplog.records)

                # 3. Identity mismatch: user sends another Google access_token but claims student101 email
                mismatch_resp = await client.post(
                    "/api/classroom/user-submissions",
                    json={
                        "group_id": group_id,
                        "email": "student101@example.test",
                        "access_token": other_tok,
                    },
                )
                assert mismatch_resp.status_code == 200
                assert mismatch_resp.json()["connected"] is False
                assert mismatch_resp.json()["reason"] == "identity_mismatch"

                # 4. Disable CLASSROOM_LEGACY_AUTH -> unverified email/google_user_id/X-Classroom-Email rejected!
                monkeypatch.setattr(settings, "classroom_legacy_auth", False)
                from app.services.classroom_access import invalidate_classroom_access_cache
                invalidate_classroom_access_cache()

                # 4a. Unverified user-submissions rejected
                blocked_sub = await client.post(
                    "/api/classroom/user-submissions",
                    json={"group_id": group_id, "email": "student101@example.test"},
                )
                assert blocked_sub.status_code == 200
                assert blocked_sub.json()["connected"] is False
                assert blocked_sub.json()["reason"] == "unauthenticated"

                # 4b. Unverified X-Classroom-Email on group status rejected (requires_auth=True)
                blocked_status = await client.get(
                    f"/api/classroom/groups/{group_id}/status",
                    headers={"X-Classroom-Email": "student101@example.test"},
                )
                assert blocked_status.status_code == 200
                assert blocked_status.json()["requires_auth"] is True

                # 4c. Unverified disconnect rejected with 401
                blocked_disc = await client.post(
                    "/api/classroom/disconnect",
                    json={"group_id": group_id, "google_user_id": "uid_verified_101"},
                )
                assert blocked_disc.status_code == 401

                # 5. With CLASSROOM_LEGACY_AUTH=false, signed X-Classroom-Session succeeds everywhere!
                verified_sub = await client.post(
                    "/api/classroom/user-submissions",
                    headers={"X-Classroom-Session": signed_tok},
                    json={"group_id": group_id},
                )
                assert verified_sub.status_code == 200
                v_body = verified_sub.json()
                assert v_body["connected"] is True
                assert "access_token" not in v_body
                assert v_body.get("session_token")

                verified_status = await client.get(
                    f"/api/classroom/groups/{group_id}/status",
                    headers={"X-Classroom-Session": signed_tok},
                )
                assert verified_status.status_code == 200
                assert verified_status.json()["requires_auth"] is False

                verified_disc = await client.post(
                    "/api/classroom/disconnect",
                    headers={"X-Classroom-Session": signed_tok},
                    json={"group_id": group_id},
                )
                assert verified_disc.status_code == 200
                assert verified_disc.json()["deleted_credentials"] == 1
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
