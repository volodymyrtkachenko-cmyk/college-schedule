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
async def test_no_limit_on_substitutions_and_swaps_auto_publishes(ctx, monkeypatch):
    db, ids = ctx
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

    # Even if 100% of a group's lessons or 60+ lessons across dates have substitutions/swaps, auto-import publishes them without blocking
    base_date = date(2026, 10, 20)
    subs = [
        {
            "group_id": ids["group_id"],
            "subject_id": ids["subject_id"],
            "teacher_id": ids["teacher_id"],
            "second_teacher_id": None,
            "date": (base_date + timedelta(days=day_offset)).isoformat(),
            "lesson_number": i,
            "week_type": "both",
            "room": "101",
            "is_explicit_substitution": True,
        }
        for day_offset in range(15)
        for i in range(1, 5)
    ]
    setup_kre_mock(monkeypatch, ids, substitutions=subs)

    result = await admin_import._do_import(db, 2, "no-limit-test")

    assert result["status"] == "success"
    assert result["meta"]["is_anomaly"] is False
    assert result["meta"]["auto_published"] is True
    assert result["meta"]["draft_created"] is None
    assert result["meta"]["publication_id"] is not None


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


@pytest.mark.anyio
async def test_auto_import_publishes_substitutions_and_keeps_cancellations_in_draft(ctx, monkeypatch):
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
    canc = {
        "group_id": ids["group_id"],
        "date": target_date,
        "lesson_number": 3,
        "week_type": "denominator",
    }
    setup_kre_mock(monkeypatch, ids, substitutions=[sub], cancelled=[canc])

    result = await admin_import._do_import(db, 2, "sub-and-canc-test", actor_id=None)

    assert result["status"] == "success"
    assert result["meta"]["auto_published"] is True

    # Substitution was published immediately
    pub = await db.get(SchedulePublication, result["meta"]["publication_id"])
    assert pub is not None
    assert pub.changes_count == 1
    changes = (await db.scalars(select(ImportedScheduleChange).where(ImportedScheduleChange.publication_id == pub.id))).all()
    assert len(changes) == 1
    assert changes[0].kind == "substitution"
    assert changes[0].lesson_number == 2

    # Cancellation was preserved in a pending review draft for admin confirmation
    pending_drafts = (await db.scalars(
        select(ScheduleDraft).where(ScheduleDraft.draft_type == "import", ScheduleDraft.status == "pending")
    )).all()
    assert len(pending_drafts) == 1
    cancellation_draft = pending_drafts[0]
    assert len(cancellation_draft.data.get("cancelled", [])) == 1
    assert cancellation_draft.data["cancelled"][0]["lesson_number"] == 3


@pytest.mark.anyio
async def test_auto_import_skips_publication_when_no_changes_compared_to_previous_publication(ctx, monkeypatch):
    db, ids = ctx
    target_date = (date(2026, 10, 20)).isoformat()
    sub1 = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "second_teacher_id": None,
        "date": target_date,
        "lesson_number": 2,
        "week_type": "denominator",
        "room": "101",
    }
    setup_kre_mock(monkeypatch, ids, substitutions=[sub1])

    # 1. First run: changes exist -> publishes
    res1 = await admin_import._do_import(db, 2, "initial-run", actor_id=None)
    assert res1["status"] == "success"
    assert res1["meta"]["auto_published"] is True
    first_pub_id = res1["meta"]["publication_id"]
    assert first_pub_id is not None

    pub_count = await db.scalar(select(func.count(SchedulePublication.id)))
    assert pub_count == 1

    # 2. Second run: identical substitutions on site -> skips publication (unchanged=True)
    res2 = await admin_import._do_import(db, 2, "second-run-same", actor_id=None)
    assert res2["status"] == "success"
    assert res2["meta"]["unchanged"] is True
    assert res2["meta"]["auto_published"] is False
    assert res2["meta"]["publication_id"] is None

    # Verify no second publication was created
    pub_count_after = await db.scalar(select(func.count(SchedulePublication.id)))
    assert pub_count_after == 1

    # 3. Third run: new substitution added -> changes detected -> publishes new publication
    sub2 = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject_id"],
        "teacher_id": ids["teacher_id"],
        "second_teacher_id": None,
        "date": target_date,
        "lesson_number": 3,
        "week_type": "denominator",
        "room": "102",
    }
    setup_kre_mock(monkeypatch, ids, substitutions=[sub1, sub2], html_content="<html>third-run-changed</html>")

    res3 = await admin_import._do_import(db, 2, "third-run-changed", actor_id=None)
    assert res3["status"] == "success"
    assert res3["meta"]["auto_published"] is True
    assert res3["meta"]["publication_id"] is not None
    assert res3["meta"]["publication_id"] != first_pub_id

    pub_count_final = await db.scalar(select(func.count(SchedulePublication.id)))
    assert pub_count_final == 2


def test_next_auto_import_schedule():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    kyiv = ZoneInfo("Europe/Kyiv")

    # 1. Неділя 15:00 -> наступний слот у неділю о 20:00 (перед робочим понеділком)
    dt_sun_afternoon = datetime(2026, 10, 18, 15, 0, 0, tzinfo=kyiv)
    target = admin_import.get_next_auto_import_target(dt_sun_afternoon)
    assert target.weekday() == 6  # Неділя
    assert target.hour == 20
    assert target.minute == 0
    assert admin_import.get_next_auto_import_delay_seconds(dt_sun_afternoon) == 5 * 3600

    # 2. Неділя 20:30 -> наступний слот у понеділок о 05:00 ранку (перед парами)
    dt_sun_night = datetime(2026, 10, 18, 20, 30, 0, tzinfo=kyiv)
    target = admin_import.get_next_auto_import_target(dt_sun_night)
    assert target.weekday() == 0  # Понеділок
    assert target.hour == 5
    assert target.minute == 0

    # 3. Понеділок 05:10 -> наступний слот у понеділок о 20:00
    dt_mon_morning = datetime(2026, 10, 19, 5, 10, 0, tzinfo=kyiv)
    target = admin_import.get_next_auto_import_target(dt_mon_morning)
    assert target.weekday() == 0  # Понеділок
    assert target.hour == 20

    # 4. П'ятниця 05:10 -> наступний слот у неділю о 20:00 (вихідні пропускаються, бо в суботу немає пар)
    dt_fri_morning = datetime(2026, 10, 23, 5, 10, 0, tzinfo=kyiv)
    target = admin_import.get_next_auto_import_target(dt_fri_morning)
    assert target.weekday() == 6  # Неділя
    assert target.hour == 20

    # 5. Субота 12:00 -> наступний слот у неділю о 20:00
    dt_sat_noon = datetime(2026, 10, 24, 12, 0, 0, tzinfo=kyiv)
    target = admin_import.get_next_auto_import_target(dt_sat_noon)
    assert target.weekday() == 6  # Неділя
    assert target.hour == 20


@pytest.mark.anyio
async def test_main_page_hash_fast_exit(ctx, monkeypatch):
    db, ids = ctx
    setup_kre_mock(monkeypatch, ids)

    # Встановлюємо збережений хеш головної сторінки
    test_hash = "abc123fixedhash"
    await settings_service.set(db, "import_last_main_page_hash", test_hash)
    await db.commit()

    # Мокаємо fetcher щоб повертав такий самий хеш
    fetcher_mock = Mock()
    fetcher_mock.base_url = "https://kre.dp.ua"
    fetcher_mock.fetch_html = AsyncMock(return_value="<html>test</html>")
    fetcher_mock.get_all_group_ids = AsyncMock(return_value=["test-grp"])
    fetcher_mock.last_main_page_hash = test_hash
    monkeypatch.setattr(admin_import, "ScheduleFetcher", lambda: fetcher_mock)

    # 1. Автоімпорт (actor_id=None): сторінка не змінилася -> повертає unchanged=True без парсингу груп
    res = await admin_import._do_import(db, 2, "hash-test", actor_id=None)
    assert res["status"] == "success"
    assert res["meta"]["unchanged"] is True
    assert res["meta"]["reason"] == "main_page_unchanged"

    # 2. Ручний імпорт (actor_id=ids["admin_user_id"]): швидкий вихід НЕ застосовується, йде повна перевірка
    res_manual = await admin_import._do_import(db, 2, "hash-manual-test", actor_id=ids["admin_user_id"])
    assert res_manual["status"] == "success"
    assert res_manual["meta"]["reason"] != "main_page_unchanged"


@pytest.mark.anyio
async def test_prune_stale_data(ctx):
    db, ids = ctx
    from datetime import datetime, timezone, timedelta
    from app.models import ScheduleDraft, TokenBlocklist
    from app.models.entities import SchedulePublication, SchedulePublicationSnapshot

    now_utc = datetime.now(timezone.utc)

    # 1. Створюємо чернетки: стару (> 45 днів, discarded) та нову (pending)
    old_draft = ScheduleDraft(
        name="Стара чернетка",
        draft_type="import",
        status="discarded",
        created_at=now_utc - timedelta(days=50),
    )
    fresh_draft = ScheduleDraft(
        name="Свіжа чернетка",
        draft_type="import",
        status="pending",
        created_at=now_utc - timedelta(days=1),
    )
    db.add_all([old_draft, fresh_draft])

    # 2. Створюємо токени: старий (> 7 днів) та свіжий
    old_token = TokenBlocklist(jti="old-token-jti", created_at=now_utc - timedelta(days=10))
    fresh_token = TokenBlocklist(jti="fresh-token-jti", created_at=now_utc - timedelta(days=2))
    db.add_all([old_token, fresh_token])

    # 3. Створюємо зміну розкладу: стару неопубліковану (> 60 днів)
    old_change = ImportedScheduleChange(
        date=(now_utc - timedelta(days=70)).date(),
        kind="substitution",
        group_id=ids["group_id"],
        subject_id=ids["subject_id"],
        teacher_id=ids["teacher_id"],
        lesson_number=1,
        is_published=False,
    )
    fresh_change = ImportedScheduleChange(
        date=(now_utc - timedelta(days=5)).date(),
        kind="substitution",
        group_id=ids["group_id"],
        subject_id=ids["subject_id"],
        teacher_id=ids["teacher_id"],
        lesson_number=1,
        is_published=True,
    )
    db.add_all([old_change, fresh_change])

    # 4. Створюємо 6 публікацій, щоб найстаріша могла бути очищена
    pubs = []
    for i in range(6):
        p = SchedulePublication(
            version_id=ids["version_id"],
            scope_manifest="{}",
            timestamp=now_utc - timedelta(days=70 - i),
        )
        db.add(p)
        pubs.append(p)
    await db.commit()

    # Додаємо знімок до найстарішої публікації
    snap = SchedulePublicationSnapshot(
        publication_id=pubs[0].id,
        group_id=ids["group_id"],
        lesson_number=1,
    )
    db.add(snap)
    await db.commit()

    # Запускаємо очищення
    stats = await admin_import.prune_stale_data(db)

    assert stats["pruned_drafts"] == 1
    assert stats["pruned_tokens"] == 1
    assert stats["pruned_changes"] == 1
    assert stats["pruned_snapshots"] == 1

    # Перевіряємо що свіжі сутності лишилися
    remaining_draft = await db.get(ScheduleDraft, fresh_draft.id)
    assert remaining_draft is not None
    remaining_token = await db.scalar(select(TokenBlocklist).where(TokenBlocklist.jti == "fresh-token-jti"))
    assert remaining_token is not None
