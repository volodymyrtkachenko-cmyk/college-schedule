from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import pytest
from fastapi import HTTPException
from sqlalchemy import select, func, event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.database import Base
from app.models import (
    Group,
    Subject,
    Teacher,
    Schedule,
    ScheduleDraft,
    ImportedScheduleChange,
    ScheduleVersion,
)
from app.models.entities import SchedulePublication, SchedulePublicationSnapshot
from app.routers import admin_import, schedule_versions
from app.services.settings import settings_service


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def ctx():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def fk(connection, _):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        g = Group(name="Група 101")
        s = Subject(name="Математика")
        t = Teacher(name="Іванов І.І.")
        v = ScheduleVersion(
            name="Семестр 1",
            valid_from=date(2026, 9, 1),
            valid_until=date(2026, 12, 31),
            is_active=True,
        )
        from app.models import User
        u = User(username="admin", name="Admin", password_hash="pw", role="admin")
        db.add_all([g, s, t, v, u])
        await db.commit()
        yield db, {"group_id": g.id, "subject_id": s.id, "teacher_id": t.id, "version_id": v.id, "admin_user_id": u.id}
    await engine.dispose()


def setup_kre_mock(monkeypatch, ids, substitutions=None, cancelled=None, html_content="<html>test</html>"):
    monkeypatch.setattr(admin_import.ScheduleFetcher, "get_all_group_ids", AsyncMock(return_value=["test-grp"]))
    monkeypatch.setattr(admin_import.ScheduleFetcher, "fetch_html", AsyncMock(return_value=html_content))
    monkeypatch.setattr(admin_import.KREParser, "parse", Mock(return_value=SimpleNamespace(week_type="denominator", lessons=[SimpleNamespace(date=date(2026, 10, 20))])))
    monkeypatch.setattr(admin_import.EntityNormalizer, "load_dictionaries", AsyncMock())
    monkeypatch.setattr(admin_import.ScheduleDiffer, "diff", AsyncMock(return_value={
        "unresolved": [],
        "unresolved_substitutions": [],
        "substitutions": substitutions or [],
        "cancelled": cancelled or [],
        "base_slots": [],
        "skipped_base_slots": [],
    }))


@pytest.mark.anyio
async def test_auto_import_applies_changes_without_admin_confirmation(ctx, monkeypatch):
    db, ids = ctx
    target_date = (date(2026, 10, 20)).isoformat()
    sub = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "second_teacher_id": None,
        "date": target_date,
        "lesson_number": 2,
        "week_type": "denominator",
        "room": "101",
    }
    setup_kre_mock(monkeypatch, ids, substitutions=[sub])

    # Run background auto-import (actor_id=None -> source='auto')
    result = await admin_import._do_import(db, 2, "auto-test", actor_id=None)

    assert result["status"] == "success"
    assert result["meta"]["auto_published"] is True
    assert result["meta"]["draft_created"] is None
    assert result["meta"]["publication_id"] is not None

    # Check publication record
    pub = await db.get(SchedulePublication, result["meta"]["publication_id"])
    assert pub is not None
    assert pub.source == "auto"
    assert pub.changes_count == 1
    assert pub.is_reverted is False

    # Check imported change was immediately published
    changes = (await db.scalars(select(ImportedScheduleChange).where(ImportedScheduleChange.publication_id == pub.id))).all()
    assert len(changes) == 1
    assert changes[0].is_published is True
    assert changes[0].kind == "substitution"
    assert changes[0].lesson_number == 2

    # Check permanent Schedule table was untouched
    sched_count = await db.scalar(select(func.count()).select_from(Schedule))
    assert sched_count == 0

    # Check notification was created
    status = await admin_import.get_import_status_endpoint(db=db, user=SimpleNamespace(id=1, role="admin"))
    assert status["last_publication"] is not None
    assert status["last_publication"]["source"] == "Авто"
    assert status["last_publication"]["changes_count"] == 1
    assert status["active_notification"] is not None
    assert status["active_notification"]["changes_count"] == 1


@pytest.mark.anyio
async def test_manual_button_also_auto_publishes(ctx, monkeypatch):
    db, ids = ctx
    target_date = (date(2026, 10, 20)).isoformat()
    sub = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "second_teacher_id": None,
        "date": target_date,
        "lesson_number": 3,
        "week_type": "denominator",
        "room": "103",
    }
    canc = {
        "group_id": ids["group_id"],
        "date": target_date,
        "lesson_number": 4,
        "week_type": "denominator",
    }
    setup_kre_mock(monkeypatch, ids, substitutions=[sub], cancelled=[canc])

    # Manual import with user ID: auto-publishes substitution, never auto-cancels lesson 4
    result = await admin_import._do_import(db, 2, "manual-btn-test", actor_id=ids["admin_user_id"])

    assert result["status"] == "success"
    assert result["meta"]["auto_published"] is True
    pub = await db.get(SchedulePublication, result["meta"]["publication_id"])
    assert pub.source == "manual"
    assert pub.actor_id == ids["admin_user_id"]
    assert pub.changes_count == 1
    changes = (await db.scalars(select(ImportedScheduleChange).where(ImportedScheduleChange.publication_id == pub.id))).all()
    assert len(changes) == 1
    assert changes[0].kind == "substitution"
    assert changes[0].lesson_number == 3


@pytest.mark.anyio
async def test_auto_publish_disabled_uses_draft_model(ctx, monkeypatch):
    db, ids = ctx
    await settings_service.set(db, "import_auto_publish", "false")

    target_date = (date(2026, 10, 20)).isoformat()
    sub = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "second_teacher_id": None,
        "date": target_date,
        "lesson_number": 1,
        "week_type": "denominator",
        "room": "102",
    }
    setup_kre_mock(monkeypatch, ids, substitutions=[sub])

    result = await admin_import._do_import(db, 2, "draft-test", actor_id=None)

    assert result["meta"]["auto_published"] is False
    assert result["meta"]["draft_created"] is not None
    draft = await db.get(ScheduleDraft, result["meta"]["draft_created"])
    assert draft is not None
    assert draft.status == "pending"


@pytest.mark.anyio
async def test_anomaly_threshold_exceeded_creates_pending_draft(ctx, monkeypatch):
    db, ids = ctx
    # Add some base schedule lessons (e.g. 5 lessons for group 101)
    base_schedules = [
        Schedule(
            group_id=ids["group_id"],
            subject_id=ids["subject_id"],
            teacher_id=ids["teacher_id"],
            day_of_week=2,  # Tuesday
            lesson_number=i,
            week_type="both",
            is_active=True,
            version_id=ids["version_id"],
        )
        for i in range(1, 5)
    ]
    db.add_all(base_schedules)
    await db.commit()

    # Create 3 substitutions for group 101 on a Tuesday -> 3 / 4 = 75% > 30% anomaly threshold!
    target_date = (date(2026, 10, 20)).isoformat()  # Tuesday
    subs = [
        {
            "group_id": ids["group_id"],
            "subject_id": ids["subject_id"],
            "teacher_id": ids["teacher_id"],
            "second_teacher_id": None,
            "date": target_date,
            "lesson_number": i,
            "week_type": "both",
            "room": "101",
        }
        for i in range(1, 4)
    ]
    setup_kre_mock(monkeypatch, ids, substitutions=subs)

    result = await admin_import._do_import(db, 2, "anomaly-test")

    assert result["status"] == "anomaly_draft"
    assert result["meta"]["is_anomaly"] is True
    assert result["meta"]["auto_published"] is False
    assert result["meta"]["draft_created"] is not None

    draft = await db.get(ScheduleDraft, result["meta"]["draft_created"])
    assert draft.data.get("is_anomaly") is True
    assert len(result["meta"]["anomaly_reasons"]) > 0

    # Status check confirms pending anomaly draft
    status = await admin_import.get_import_status_endpoint(db=db, user=SimpleNamespace(id=1, role="admin"))
    assert status["pending_anomaly_draft"] is not None
    assert status["anomaly_drafts_count"] == 1


@pytest.mark.anyio
async def test_manually_edited_changes_are_not_overwritten(ctx, monkeypatch):
    db, ids = ctx
    target_date = date(2026, 10, 20)

    # Pre-existing manually edited change
    manual_change = ImportedScheduleChange(
        date=target_date,
        kind="substitution",
        group_id=ids["group_id"],
        subject_id=ids["subject_id"],
        teacher_id=ids["teacher_id"],
        lesson_number=2,
        is_published=True,
        manually_edited=True,
        version=1,
    )
    db.add(manual_change)
    await db.commit()

    # Import tries to substitute lesson 2
    sub = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "second_teacher_id": None,
        "date": target_date.isoformat(),
        "lesson_number": 2,
        "week_type": "denominator",
        "room": "999",
    }
    setup_kre_mock(monkeypatch, ids, substitutions=[sub])

    result = await admin_import._do_import(db, 2, "manual-guard-test")

    # Lesson 2 should be skipped
    assert len(result["report"]["skipped_manual"]) == 1
    assert result["report"]["skipped_manual"][0]["lesson_number"] == 2

    # Existing record still intact and published
    await db.refresh(manual_change)
    assert manual_change.is_published is True
    assert manual_change.manually_edited is True


@pytest.mark.anyio
async def test_reverted_changes_suppressed_until_source_changes(ctx, monkeypatch):
    db, ids = ctx
    target_date = (date(2026, 10, 20)).isoformat()
    sub = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "second_teacher_id": None,
        "date": target_date,
        "lesson_number": 4,
        "week_type": "denominator",
        "room": "104",
    }
    initial_html = "<html>Initial KRE Content</html>"
    setup_kre_mock(monkeypatch, ids, substitutions=[sub], html_content=initial_html)

    # 1. First import auto-publishes
    first_res = await admin_import._do_import(db, 2, "revert-test-1")
    pub_id = first_res["meta"]["publication_id"]
    assert pub_id is not None

    # 2. Admin reverts this publication
    await schedule_versions.revert_publication(pub_id, db=db, user=SimpleNamespace(id=1, role="admin"))
    pub = await db.get(SchedulePublication, pub_id)
    assert pub.is_reverted is True

    # Check imported changes were deactivated
    chgs = (await db.scalars(select(ImportedScheduleChange).where(ImportedScheduleChange.publication_id == pub_id))).all()
    assert all(c.is_published is False for c in chgs)

    # 3. Next import with same HTML content should SUPPRESS the reverted changes!
    second_res = await admin_import._do_import(db, 2, "revert-test-2")
    assert len(second_res["report"]["skipped_reverted"]) == 1
    assert second_res["report"]["skipped_reverted"][0]["lesson_number"] == 4

    # 4. If KRE page content changes, suppression expires and changes are accepted
    updated_html = "<html>Updated KRE Content With Edits</html>"
    setup_kre_mock(monkeypatch, ids, substitutions=[sub], html_content=updated_html)
    third_res = await admin_import._do_import(db, 2, "revert-test-3")
    assert len(third_res["report"]["skipped_reverted"]) == 0
    assert third_res["meta"]["auto_published"] is True


@pytest.mark.anyio
async def test_publication_changes_diff_endpoint(ctx, monkeypatch):
    db, ids = ctx
    target_date = (date(2026, 10, 20)).isoformat()
    sub = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "second_teacher_id": None,
        "date": target_date,
        "lesson_number": 1,
        "week_type": "denominator",
        "room": "205",
    }
    setup_kre_mock(monkeypatch, ids, substitutions=[sub])

    result = await admin_import._do_import(db, 2, "diff-test")
    pub_id = result["meta"]["publication_id"]

    # Call GET /publications/{pub_id}/changes
    changes = await schedule_versions.get_publication_changes(pub_id, db=db, user=SimpleNamespace(id=1, role="admin"))
    assert len(changes) == 1
    ch = changes[0]
    assert ch["group_id"] == ids["group_id"]
    assert ch["group_name"] == "Група 101"
    assert ch["lesson_number"] == 1
    assert ch["kind"] == "substitution"
    assert "Математика" in ch["after"]
