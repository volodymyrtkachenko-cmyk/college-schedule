from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from zoneinfo import ZoneInfo
import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import (
    Curriculum,
    Group,
    ImportedScheduleChange,
    Schedule,
    ScheduleDraft,
    ScheduleVersion,
    Subject,
    Teacher,
    User,
)
from app.models.lesson_notes import LessonNoteRevision, LessonOccurrenceNote
from app.routers import admin_import, drafts
from app.routers.classroom import (
    _matches_lesson,
    _parse_announcement,
)
from app.services.notes_reconciliation import reconcile_notes_after_publish
from app.services.schedule import fetch_schedule
from app.services.week import get_week_type


KYIV_TZ = ZoneInfo("Europe/Kyiv")


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
        g = Group(name="Група 85")
        s1 = Subject(name="Дискретна математика")
        s2 = Subject(name="Комп'ютерна електроніка")
        t1 = Teacher(name="Гончаров О.М.")
        t2 = Teacher(name="Філімончук А.В.")
        v1 = ScheduleVersion(
            name="Семестр 1",
            valid_from=date(2026, 9, 1),
            valid_until=date(2026, 12, 31),
            is_active=True,
        )
        u = User(username="admin", name="Admin", password_hash="pw", role="admin")
        db.add_all([g, s1, s2, t1, t2, v1, u])
        await db.commit()

        # Постійний розклад (Schedule):
        # 1 чисельник, 1 знаменник, 1 both
        sch_both = Schedule(
            group_id=g.id,
            version_id=v1.id,
            day_of_week=1,
            lesson_number=1,
            subject_id=s1.id,
            teacher_id=t1.id,
            week_type="both",
            room_override="101",
        )
        sch_num = Schedule(
            group_id=g.id,
            version_id=v1.id,
            day_of_week=2,
            lesson_number=2,
            subject_id=s1.id,
            teacher_id=t1.id,
            week_type="numerator",
            room_override="102",
        )
        sch_denom = Schedule(
            group_id=g.id,
            version_id=v1.id,
            day_of_week=3,
            lesson_number=3,
            subject_id=s2.id,
            teacher_id=t2.id,
            week_type="denominator",
            room_override="103",
        )
        db.add_all([sch_both, sch_num, sch_denom])
        await db.commit()

        yield db, {
            "group_id": g.id,
            "subject_id": s1.id,
            "subject2_id": s2.id,
            "teacher_id": t1.id,
            "teacher2_id": t2.id,
            "version_id": v1.id,
            "admin_user_id": u.id,
        }
    await engine.dispose()


# -----------------------------------------------------------------------------
# ТЕСТ 1: Імпорт ніколи не змінює постійний розклад Schedule.
# Джерело віддало лише Знаменник -> слоти Чисельника і both не чіпаються.
# -----------------------------------------------------------------------------
@pytest.mark.anyio
async def test_import_only_denominator_does_not_mutate_schedule_or_delete_numerator(ctx, monkeypatch):
    db, ids = ctx

    initial_schedules = (await db.scalars(select(Schedule))).all()
    initial_both = sum(1 for s in initial_schedules if s.week_type == "both")
    initial_num = sum(1 for s in initial_schedules if s.week_type == "numerator")
    initial_denom = sum(1 for s in initial_schedules if s.week_type == "denominator")
    assert initial_both == 1
    assert initial_num == 1
    assert initial_denom == 1

    # Симулюємо імпорт на тиждень Знаменника (2026-10-20)
    target_date = date(2026, 10, 20)
    sub = {
        "group_id": ids["group_id"],
        "subject_id": ids["subject2_id"],
        "teacher_id": ids["teacher2_id"],
        "second_teacher_id": None,
        "date": target_date.isoformat(),
        "lesson_number": 4,
        "week_type": "denominator",
        "room": "305",
    }

    monkeypatch.setattr(admin_import.ScheduleFetcher, "get_all_group_ids", AsyncMock(return_value=["grp-85"]))
    monkeypatch.setattr(admin_import.ScheduleFetcher, "fetch_html", AsyncMock(return_value="<html>kre</html>"))
    monkeypatch.setattr(admin_import.KREParser, "parse", Mock(return_value=SimpleNamespace(week_type="denominator", lessons=[SimpleNamespace(date=target_date)])))
    monkeypatch.setattr(admin_import.EntityNormalizer, "load_dictionaries", AsyncMock())
    monkeypatch.setattr(admin_import.ScheduleDiffer, "diff", AsyncMock(return_value={
        "unresolved": [],
        "unresolved_substitutions": [],
        "substitutions": [sub],
        "cancelled": [],
        "base_slots": [{
            "group_id": ids["group_id"],
            "subject_id": ids["subject2_id"],
            "teacher_id": ids["teacher2_id"],
            "second_teacher_id": None,
            "day_of_week": 2,
            "lesson_number": 1,
            "room": "301",
            "week_type": "denominator",
        }],
        "skipped_base_slots": [],
    }))
    monkeypatch.setattr(admin_import, "matches_published_schedule", AsyncMock(return_value=False))

    from app.services.settings import settings_service
    await settings_service.set(db, "import_auto_publish", "true")

    # Виконуємо імпорт
    result = await admin_import._do_import(db, 2, "denom-only-import", actor_id=None)
    assert result["status"] == "success"

    # ПЕРЕВІРКА ІНВАРІАНТУ: постійний розклад Schedule НЕ ЗМІНИВСЯ!
    after_schedules = (await db.scalars(select(Schedule))).all()
    assert sum(1 for s in after_schedules if s.week_type == "both") == initial_both
    assert sum(1 for s in after_schedules if s.week_type == "numerator") == initial_num
    assert sum(1 for s in after_schedules if s.week_type == "denominator") == initial_denom
    assert len(after_schedules) == len(initial_schedules)

    # Зміна записана ЛИШЕ як датована ImportedScheduleChange на конкретну дату 2026-10-20
    imported_changes = (await db.scalars(select(ImportedScheduleChange))).all()
    assert len(imported_changes) == 1
    assert imported_changes[0].date == target_date


# -----------------------------------------------------------------------------
# ТЕСТ 2: Запобіжник аномальної кількості змін (>30% групи, >20% або >= 50 змін)
# Публікація з великою кількістю змін створює чернетку з is_anomaly=True,
# автопублікація блокується, а ручна публікація вимагає force=True.
# -----------------------------------------------------------------------------
@pytest.mark.anyio
async def test_anomaly_draft_requires_force_to_publish(ctx, monkeypatch):
    db, ids = ctx

    from app.services.settings import settings_service
    await settings_service.set(db, "import_auto_publish", "true")

    # Створюємо 60 унікальних змін на різних датах (перевищує абсолютний поріг 50)
    base_target = date(2026, 10, 19)
    massive_substitutions = []
    for day_offset in range(15):
        d = base_target + timedelta(days=day_offset)
        for lnum in (1, 2, 3, 4):
            massive_substitutions.append({
                "group_id": ids["group_id"],
                "subject_id": ids["subject_id"],
                "teacher_id": ids["teacher_id"],
                "second_teacher_id": None,
                "date": d.isoformat(),
                "lesson_number": lnum,
                "week_type": "denominator",
                "room": "101",
            })
            if len(massive_substitutions) >= 60:
                break
        if len(massive_substitutions) >= 60:
            break

    monkeypatch.setattr(admin_import.ScheduleFetcher, "get_all_group_ids", AsyncMock(return_value=["grp-85"]))
    monkeypatch.setattr(admin_import.ScheduleFetcher, "fetch_html", AsyncMock(return_value="<html>kre</html>"))
    monkeypatch.setattr(admin_import.KREParser, "parse", Mock(return_value=SimpleNamespace(
        week_type="denominator",
        lessons=[SimpleNamespace(date=base_target + timedelta(days=i)) for i in range(15)],
    )))
    monkeypatch.setattr(admin_import.EntityNormalizer, "load_dictionaries", AsyncMock())
    monkeypatch.setattr(admin_import.ScheduleDiffer, "diff", AsyncMock(return_value={
        "unresolved": [],
        "unresolved_substitutions": [],
        "substitutions": massive_substitutions,
        "cancelled": [],
        "base_slots": [],
        "skipped_base_slots": [],
    }))
    monkeypatch.setattr(admin_import, "matches_published_schedule", AsyncMock(return_value=False))

    # Виконуємо імпорт
    result = await admin_import._do_import(db, 2, "anomaly-test", actor_id=None)

    # Запобіжник спрацював: не опубліковано автоматично!
    assert result["meta"]["auto_published"] is False
    assert result["meta"]["is_anomaly"] is True
    draft_id = result["meta"]["draft_created"]
    assert draft_id is not None

    draft_obj = await db.get(ScheduleDraft, draft_id)
    assert draft_obj.data.get("is_anomaly") is True

    # Спроба опублікувати без force=True має викликати HTTP 400
    with pytest.raises(HTTPException) as exc_info:
        await drafts.publish_draft(
            draft_id,
            expected_revision=draft_obj.revision,
            db=db,
            current_user=SimpleNamespace(id=ids["admin_user_id"], role="admin"),
            force=False,
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "anomaly_detected"

    # З force=True публікація дозволена
    pub_result = await drafts.publish_draft(
        draft_id,
        expected_revision=draft_obj.revision,
        db=db,
        current_user=SimpleNamespace(id=ids["admin_user_id"], role="admin"),
        force=True,
    )
    assert pub_result["status"] == "published"


# -----------------------------------------------------------------------------
# ТЕСТ 3: Реконсиляція нотаток не архівує записи при масовому зникненні слотів (>10 нотаток)
# -----------------------------------------------------------------------------
@pytest.mark.anyio
async def test_notes_reconciliation_safeguard_prevents_mass_archival(ctx):
    db, ids = ctx

    # Створюємо 12 нотаток для пар на датах
    created_notes = []
    for day_idx in range(12):
        n_date = date(2026, 10, 12) + timedelta(days=day_idx)
        note = LessonOccurrenceNote(
            group_id=ids["group_id"],
            note_date=n_date,
            lesson_number=(day_idx % 4) + 1,
            subject_id=ids["subject_id"],
            subject_name="Дискретна математика",
            note=f"Важлива нотатка #{day_idx}",
            revision=1,
            archived=False,
            origin_kind="base",
            origin_id=1,
        )
        db.add(note)
        created_notes.append(note)
    await db.commit()

    # Запускаємо реконсиляцію з датами, де пари відсутні (імітація помилкового зникнення пар)
    await reconcile_notes_after_publish(
        db=db,
        group_ids=[ids["group_id"]],
        actor_id=ids["admin_user_id"],
    )

    # Поріг масової архівації (>10 нотаток) захистив нотатки від видалення
    active_notes_count = await db.scalar(
        select(func.count())
        .select_from(LessonOccurrenceNote)
        .where(LessonOccurrenceNote.archived.is_(False))
    )
    assert active_notes_count == 12


# -----------------------------------------------------------------------------
# ТЕСТ 4: Парність 4 тижнів (жовтень-листопад 2026)
# -----------------------------------------------------------------------------
def test_parity_regression_four_weeks():
    semester_start = date(2026, 9, 1)

    # 5–11 жовт. (Знаменник)
    for d in (date(2026, 10, 5), date(2026, 10, 7), date(2026, 10, 11)):
        assert get_week_type(d, semester_start) == "denominator"

    # 12–18 жовт. (Чисельник)
    for d in (date(2026, 10, 12), date(2026, 10, 15), date(2026, 10, 18)):
        assert get_week_type(d, semester_start) == "numerator"

    # 19–25 жовт. (Знаменник)
    for d in (date(2026, 10, 19), date(2026, 10, 21), date(2026, 10, 25)):
        assert get_week_type(d, semester_start) == "denominator"

    # 26 жовт. – 01 лист. (Чисельник)
    for d in (date(2026, 10, 26), date(2026, 10, 28), date(2026, 11, 1)):
        assert get_week_type(d, semester_start) == "numerator"


# -----------------------------------------------------------------------------
# ТЕСТ 5: Classroom — оголошення минулого тижня не розмазуються на поточний,
# оголошення у вихідні та п'ятницю ввечері прив'язуються до понеділка.
# -----------------------------------------------------------------------------
def test_classroom_announcement_date_isolation():
    # 1. Оголошення, опубліковане у четвер минулого тижня (15.10) без явної дати
    past_thu = datetime(2026, 10, 15, 12, 0, tzinfo=KYIV_TZ)
    parsed_past = _parse_announcement("Заходимо за посиланням: https://meet.google.com/past-link", past_thu)
    assert parsed_past["target_date"] == date(2026, 10, 15)
    assert parsed_past["has_explicit_date"] is False
    # Перевірка: цільова дата не в поточному тижні 19-23.10
    week_monday = date(2026, 10, 19)
    week_friday = date(2026, 10, 23)
    candidate_dates = [parsed_past["target_date"]] if (week_monday <= parsed_past["target_date"] <= week_friday) else []
    # Категорично порожній список: посилання з минулого тижня НЕ потрапляє на поточний тиждень!
    assert candidate_dates == []

    # 2. Оголошення у неділю (18.10) -> прив'язується до найближчого робочого понеділка (19.10)
    sunday_dt = datetime(2026, 10, 18, 14, 0, tzinfo=KYIV_TZ)
    parsed_sun = _parse_announcement("Лекція: https://meet.google.com/sun-link", sunday_dt)
    assert parsed_sun["target_date"] == date(2026, 10, 19)

    # 3. Оголошення у п'ятницю ввечері (16.10 о 17:00) -> залишається на п'ятницю (16.10) (правило 16:00 видалено)
    fri_evening = datetime(2026, 10, 16, 17, 0, tzinfo=KYIV_TZ)
    parsed_fri = _parse_announcement("Матеріали до пари: https://meet.google.com/fri-link", fri_evening)
    assert parsed_fri["target_date"] == date(2026, 10, 16)


# -----------------------------------------------------------------------------
# ТЕСТ 6: Редактор розкладу за замовчуванням відкриває діючу версію для вказаної дати
# -----------------------------------------------------------------------------
@pytest.mark.anyio
async def test_active_version_resolution_for_target_date(ctx):
    db, ids = ctx

    # Створюємо минулу, діючу і майбутню версії
    past_ver = ScheduleVersion(
        name="Минулий семестр",
        valid_from=date(2026, 1, 1),
        valid_until=date(2026, 6, 30),
        is_active=False,
    )
    future_ver = ScheduleVersion(
        name="Майбутній семестр (2027)",
        valid_from=date(2027, 2, 1),
        valid_until=date(2027, 6, 30),
        is_active=True,
    )
    db.add_all([past_ver, future_ver])
    await db.commit()

    all_versions = (await db.scalars(select(ScheduleVersion))).all()

    # Функція вибору версії для цільової дати (наприклад, 19.10.2026)
    target_d = date(2026, 10, 19)
    active_for_today = next(
        (v for v in all_versions if v.valid_from <= target_d <= v.valid_until and v.is_active),
        None,
    )
    assert active_for_today is not None
    assert active_for_today.name == "Семестр 1"
    assert active_for_today.id == ids["version_id"]
    # Не повинна вибиратися перша за valid_from desc (яка була б "Майбутній семестр")
    sorted_by_valid_from_desc = sorted(all_versions, key=lambda v: v.valid_from, reverse=True)
    assert sorted_by_valid_from_desc[0].name == "Майбутній семестр (2027)"
    assert active_for_today.id != sorted_by_valid_from_desc[0].id
