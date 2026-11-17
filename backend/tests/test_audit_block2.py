from datetime import date, datetime, time, timezone
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token, decode_token
from app.database import Base, get_db
from app.main import app
from app.models import (
    BellSchedule,
    ClassroomCredential,
    Curriculum,
    Group,
    GroupStudent,
    Schedule,
    ScheduleDraft,
    ScheduleSlot,
    ScheduleVersion,
    Subject,
    Teacher,
    TokenBlocklist,
    User,
)


@pytest.mark.anyio
async def test_finding_5_access_token_blocklist_enforced():
    """#5: Access token added to TokenBlocklist must be rejected by get_current_user and _has_admin_or_editor_access."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with sessions() as session:
        admin = User(username="admin_bl", name="Admin", password_hash="h", role="admin", is_active=True)
        session.add(admin)
        await session.commit()
        await session.refresh(admin)
        token = create_access_token(admin)
        payload = decode_token(token, "access")

    async def override_get_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Valid before blocklisting
            ok_resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
            assert ok_resp.status_code == 200

            # Blocklist the access token's jti
            async with sessions() as session:
                session.add(TokenBlocklist(jti=payload["jti"]))
                await session.commit()

            # Must now be rejected with 401
            revoked_resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
            assert revoked_resp.status_code == 401
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.anyio
async def test_finding_7_template_versions_auth_and_schedule_now_sanitization(monkeypatch):
    """#7: /api/schedule/template and /api/schedule-versions require auth; /api/schedule/now sanitizes meeting URLs in room."""
    from zoneinfo import ZoneInfo
    from app.routers import schedule_now
    from app.services import bells as bells_service
    from app.services.projection import invalidate_projection_cache

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with sessions() as session:
        admin = User(username="admin_f7", name="Admin", password_hash="h", role="admin", is_active=True)
        group = Group(name="85", is_active=True)
        subject = Subject(name="Програмування", is_active=True)
        teacher = Teacher(name="Іванов І.І.", is_active=True)
        version = ScheduleVersion(
            name="Осінь 2026",
            valid_from=date(2026, 9, 1),
            valid_until=date(2026, 12, 31),
            is_active=True,
        )
        bell = BellSchedule(lesson_number=1, start_time=time(9, 0), end_time=time(10, 20), is_active=True)
        session.add_all([admin, group, subject, teacher, version, bell])
        await session.flush()

        sched = Schedule(
            group_id=group.id,
            subject_id=subject.id,
            teacher_id=teacher.id,
            version_id=version.id,
            day_of_week=1,
            lesson_number=1,
            week_type="both",
            room_override="https://meet.google.com/abc-defg-hij",
            is_active=True,
        )
        session.add(sched)
        await session.commit()
        await session.refresh(admin)
        token = create_access_token(admin)
        v_id = version.id
        g_id = group.id

    bells_service.invalidate_bell_cache()
    invalidate_projection_cache()
    fixed_now = datetime(2026, 9, 7, 9, 30, tzinfo=ZoneInfo("Europe/Kyiv"))  # Monday
    monkeypatch.setattr(schedule_now, "now_local", lambda: fixed_now)

    async def override_get_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Unauthenticated requests to /api/schedule/template and /api/schedule-versions must fail with 401
            unauth_tpl = await client.get(f"/api/schedule/template?version_id={v_id}&group_id={g_id}")
            assert unauth_tpl.status_code == 401

            unauth_ver = await client.get("/api/schedule-versions")
            assert unauth_ver.status_code == 401

            # Authenticated requests succeed
            auth_headers = {"Authorization": f"Bearer {token}"}
            auth_tpl = await client.get(
                f"/api/schedule/template?version_id={v_id}&group_id={g_id}",
                headers=auth_headers,
            )
            assert auth_tpl.status_code == 200

            auth_ver = await client.get("/api/schedule-versions", headers=auth_headers)
            assert auth_ver.status_code == 200

            # /api/schedule/now must sanitize meeting URLs from room
            now_resp = await client.get("/api/schedule/now")
            assert now_resp.status_code == 200
            active_classes = now_resp.json()["active_classes"]
            assert len(active_classes) == 1
            assert "meet.google.com" not in active_classes[0]["room"]
    finally:
        app.dependency_overrides.clear()
        bells_service.invalidate_bell_cache()
        invalidate_projection_cache()
        await engine.dispose()


@pytest.mark.anyio
async def test_finding_8_editor_group_isolation():
    """#8: Editor cannot access foreign drafts/slots, foreign classroom accounts/students, or global shortened-days."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with sessions() as session:
        g_allowed = Group(name="Allowed-1", is_active=True)
        g_foreign = Group(name="Foreign-2", is_active=True)
        subj = Subject(name="Математика", is_active=True)
        teacher = Teacher(name="Петренко П.П.", is_active=True)
        session.add_all([g_allowed, g_foreign, subj, teacher])
        await session.flush()

        editor = User(
            username="editor_f8",
            name="Editor",
            password_hash="h",
            role="editor",
            is_active=True,
            allowed_groups=[g_allowed],
        )
        curr_foreign = Curriculum(
            group_id=g_foreign.id,
            subject_id=subj.id,
            teacher_id=teacher.id,
            pairs_per_2_weeks=2,
        )
        draft_foreign = ScheduleDraft(name="Foreign Draft", draft_type="generated", status="DRAFT")
        session.add_all([editor, curr_foreign, draft_foreign])
        await session.flush()

        slot_a = ScheduleSlot(
            draft_id=draft_foreign.id,
            curriculum_id=curr_foreign.id,
            day_of_week=1,
            lesson_number=1,
            week_type="numerator",
        )
        slot_b = ScheduleSlot(
            draft_id=draft_foreign.id,
            curriculum_id=curr_foreign.id,
            day_of_week=2,
            lesson_number=1,
            week_type="numerator",
        )
        cred_foreign = ClassroomCredential(
            group_id=g_foreign.id,
            google_user_id="uid_foreign",
            email="student@foreign.edu",
            refresh_token="enc",
        )
        st_foreign = GroupStudent(
            group_id=g_foreign.id,
            classroom_user_id="st_1",
            full_name="Іваненко Іван",
            email="ivan@foreign.edu",
        )
        session.add_all([slot_a, slot_b, cred_foreign, st_foreign])
        await session.commit()
        await session.refresh(editor)

        editor_token = create_access_token(editor)
        foreign_draft_id = draft_foreign.id
        slot_a_id = slot_a.id
        slot_b_id = slot_b.id
        foreign_group_id = g_foreign.id
        cred_id = cred_foreign.id
        student_id = st_foreign.id

    async def override_get_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        transport = ASGITransport(app=app)
        headers = {"Authorization": f"Bearer {editor_token}"}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Drafts endpoints for foreign group must return 403
            r_slots = await client.get(f"/api/drafts/{foreign_draft_id}/slots", headers=headers)
            assert r_slots.status_code == 403

            r_move = await client.patch(
                f"/api/drafts/slots/{slot_a_id}",
                json={"day_of_week": 3, "lesson_number": 2, "week_type": "numerator"},
                headers=headers,
            )
            assert r_move.status_code == 403

            r_lock = await client.patch(
                f"/api/drafts/slots/{slot_a_id}/lock",
                json={"is_locked": True},
                headers=headers,
            )
            assert r_lock.status_code == 403

            r_swap = await client.post(
                "/api/drafts/slots/swap",
                json={"slot_a_id": slot_a_id, "slot_b_id": slot_b_id, "week_type": "numerator"},
                headers=headers,
            )
            assert r_swap.status_code == 403

            # 2. Classroom account/student endpoints for foreign group must return 403
            r_del_cred = await client.delete(f"/api/classroom/credentials/{cred_id}", headers=headers)
            assert r_del_cred.status_code == 403

            r_get_st = await client.get(f"/api/classroom/groups/{foreign_group_id}/students", headers=headers)
            assert r_get_st.status_code == 403

            r_sync = await client.post(f"/api/classroom/groups/{foreign_group_id}/sync-now", headers=headers)
            assert r_sync.status_code == 403

            r_bulk = await client.post(
                f"/api/classroom/groups/{foreign_group_id}/students/bulk",
                json={"raw_text": "Петренко Петро", "replace_existing": False},
                headers=headers,
            )
            assert r_bulk.status_code == 403

            r_del_st = await client.delete(
                f"/api/classroom/groups/{foreign_group_id}/students/{student_id}",
                headers=headers,
            )
            assert r_del_st.status_code == 403

            # 3. Global shortened-days endpoints must reject editor with 403
            r_sd_add = await client.post(
                "/api/settings/shortened-days",
                json={"date": "2026-10-28", "reason": "Тест"},
                headers=headers,
            )
            assert r_sd_add.status_code == 403

            r_sd_toggle = await client.post(
                "/api/settings/shortened-days/toggle",
                json={"date": "2026-10-28"},
                headers=headers,
            )
            assert r_sd_toggle.status_code == 403

            r_sd_del = await client.delete(
                "/api/settings/shortened-days/2026-10-28",
                headers=headers,
            )
            assert r_sd_del.status_code == 403
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
