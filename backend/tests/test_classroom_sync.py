from datetime import datetime, date, timezone
from typing import Optional
from zoneinfo import ZoneInfo
import pytest

from app.routers.classroom import (
    _parse_announcement,
    _matches_lesson,
    _link_line_prefix,
    _link_line_belongs_to_sync,
)

KYIV_TZ = ZoneInfo("Europe/Kyiv")


def test_parse_announcement_weekend_maps_to_monday():
    # Sunday, Oct 18, 2026, 15:30 Kyiv time
    sunday_dt = datetime(2026, 10, 18, 15, 30, tzinfo=KYIV_TZ)
    text = "Доброго дня! Посилання на пари: https://meet.google.com/abc-defg-hij"

    parsed = _parse_announcement(text, sunday_dt)
    assert parsed is not None
    assert parsed["url"] == "https://meet.google.com/abc-defg-hij"
    # Should point to Monday Oct 19
    assert parsed["target_date"] == date(2026, 10, 19)
    assert parsed["has_explicit_date"] is False
    assert parsed["lesson_number"] is None


def test_parse_announcement_explicit_date():
    sunday_dt = datetime(2026, 10, 18, 15, 30, tzinfo=KYIV_TZ)
    text = "Консультація 21.10 на 3 пару: https://meet.google.com/xyz-uvwx-rst"

    parsed = _parse_announcement(text, sunday_dt)
    assert parsed is not None
    assert parsed["url"] == "https://meet.google.com/xyz-uvwx-rst"
    assert parsed["target_date"] == date(2026, 10, 21)
    assert parsed["has_explicit_date"] is True
    assert parsed["lesson_number"] == 3


def test_parse_announcement_today_and_tomorrow_keywords():
    monday_dt = datetime(2026, 10, 19, 10, 0, tzinfo=KYIV_TZ)

    p_today = _parse_announcement("сьогодні заняття: https://meet.google.com/today-123", monday_dt)
    assert p_today["target_date"] == date(2026, 10, 19)
    assert p_today["has_explicit_date"] is True

    p_tomorrow = _parse_announcement("завтра заняття: https://meet.google.com/tom-123", monday_dt)
    assert p_tomorrow["target_date"] == date(2026, 10, 20)
    assert p_tomorrow["has_explicit_date"] is True


def test_parse_announcement_evening_weekday_maps_to_creation_date():
    monday_evening = datetime(2026, 10, 19, 17, 30, tzinfo=KYIV_TZ)
    text = "Посилання на лекцію: https://meet.google.com/eve-123"

    parsed = _parse_announcement(text, monday_evening)
    assert parsed["target_date"] == date(2026, 10, 19)
    assert parsed["has_explicit_date"] is False


def test_parse_announcement_zoom_passcode():
    monday_dt = datetime(2026, 10, 19, 10, 0, tzinfo=KYIV_TZ)

    # 1. Zoom URL without pwd + passcode in text
    p1 = _parse_announcement("Пара у Zoom: https://zoom.us/j/123456789 Код доступу: 654321", monday_dt)
    assert p1 is not None
    assert "pwd=654321" in p1["url"]

    # 2. Zoom URL with existing ?pwd=hash + human passcode in text
    p2 = _parse_announcement("Пара у Zoom: https://zoom.us/j/123456789?pwd=YnZ4bW1iVHRwZXhh Код конференції: 778899", monday_dt)
    assert p2 is not None
    assert "pwd=YnZ4bW1iVHRwZXhh" in p2["url"]
    assert "Код доступу: 778899" in p2["url"]

    # 3. Zoom ID + passcode in text
    p3 = _parse_announcement("ID: 123 456 789 Пароль конференції: mypass123", monday_dt)
    assert p3 is not None
    assert "https://zoom.us/j/123456789" in p3["url"]
    assert "pwd=mypass123" in p3["url"]


class DummyLesson:
    def __init__(self, subject_name: str, teacher_name: str, lesson_number: int):
        self.subject_name = subject_name
        self.teacher_name = teacher_name
        self.lesson_number = lesson_number


def test_matches_lesson_by_course_title_and_teacher():
    lesson = DummyLesson(
        subject_name="Комп'ютерні мережі",
        teacher_name="Іванов І.І.",
        lesson_number=2,
    )

    # Course title matches subject keywords
    assert _matches_lesson(lesson, "комп'ютерні мережі 4 курс", "", [])

    # Author tokens match teacher
    assert _matches_lesson(lesson, "", "посилання на заняття", ["іванов"])

    # Announcement text matches subject keywords
    assert _matches_lesson(lesson, "", "пара з комп'ютерних мереж", [])

    # Completely unrelated
    assert not _matches_lesson(lesson, "історія україни", "лекція", ["петренко"])


def test_candidate_selection_multiple_lessons_without_number():
    lesson1 = DummyLesson("Вища математика", "Сидоренко С.С.", 1)
    lesson2 = DummyLesson("Вища математика", "Сидоренко С.С.", 2)
    day_lessons = [lesson1, lesson2]

    pa = {
        "url": "https://meet.google.com/math-123",
        "lesson_number": None,
        "course_title_norm": "вища математика",
        "text_norm": "посилання на заняття",
        "author_tokens": ["сидоренко"],
    }

    candidates = [
        l for l in day_lessons
        if _matches_lesson(l, pa.get("course_title_norm", ""), pa["text_norm"], pa.get("author_tokens", []))
    ]
    assert len(candidates) == 2

    if pa["lesson_number"] is not None:
        matched_lessons = [l for l in candidates if l.lesson_number == pa["lesson_number"]]
    elif candidates:
        matched_lessons = candidates
    else:
        matched_lessons = []

    assert matched_lessons == [lesson1, lesson2]


def test_candidate_selection_specific_lesson_number():
    lesson1 = DummyLesson("Вища математика", "Сидоренко С.С.", 1)
    lesson2 = DummyLesson("Вища математика", "Сидоренко С.С.", 2)
    day_lessons = [lesson1, lesson2]

    pa = {
        "url": "https://meet.google.com/math-123",
        "lesson_number": 2,
        "course_title_norm": "вища математика",
        "text_norm": "посилання на 2 пару",
        "author_tokens": ["сидоренко"],
    }

    candidates = [
        l for l in day_lessons
        if _matches_lesson(l, pa.get("course_title_norm", ""), pa["text_norm"], pa.get("author_tokens", []))
    ]
    matched_lessons = [l for l in candidates if l.lesson_number == pa["lesson_number"]]
    assert matched_lessons == [lesson2]


def test_bundle_items_unpacking_handles_6_items_safely():
    """Verify that bundle processing does not crash when 6 items (including student submissions) are present."""
    course = {"id": "c1", "name": "Тестовий курс"}
    # 6 items: teachers, announcements, courseWork, topics, materials, submissions
    bundle_6 = [
        {"teachers": []},
        {"announcements": []},
        {"courseWork": []},
        {"topic": []},
        {"courseWorkMaterial": []},
        {"studentSubmissions": []},
    ]
    bundles = [(course, bundle_6)]

    # Pass 1 logic
    for c, items in bundles:
        if len(items) >= 6:
            t, a, cw, top, mat, sub = items[:6]
        else:
            t, a, cw, top, mat = items[:5]
            sub = None
        assert sub is not None

    # Pass 2 logic
    processed = 0
    for c, items in bundles:
        if len(items) < 5:
            continue
        ann_resp = items[1]
        cw_resp = items[2]
        mat_resp = items[4]
        assert ann_resp == {"announcements": []}
        assert cw_resp == {"courseWork": []}
        assert mat_resp == {"courseWorkMaterial": []}
        processed += 1
    assert processed == 1


def test_due_date_binds_to_due_week_lesson_not_pushed_forward():
    """Rule 13.1: Task due 15-16 Oct must bind to lesson in that week (15-16 Oct), NOT 22 Oct."""
    lesson_last_week = DummyLesson("Основи філософських знань", "Домніна Г.С.", 2)
    lesson_this_week = DummyLesson("Основи філософських знань", "Домніна Г.С.", 2)

    horizon_lessons_by_date = {
        date(2026, 10, 15): [lesson_last_week],
        date(2026, 10, 22): [lesson_this_week],
    }
    sorted_horizon_dates = sorted(horizon_lessons_by_date.keys())

    # Task due Thursday 15 Oct 2026
    due_date = date(2026, 10, 15)
    due_monday = due_date - (due_date.weekday() * date.resolution)
    due_friday = due_monday + (4 * date.resolution)

    combined_cw_text = "філософія тестування - німецька класична"
    author_tokens = ["домніна"]

    week_candidates = [
        (d, l)
        for d in sorted_horizon_dates
        if due_monday <= d <= due_friday and d in horizon_lessons_by_date
        for l in horizon_lessons_by_date[d]
        if _matches_lesson(l, combined_cw_text, "", author_tokens)
    ]

    assert len(week_candidates) == 1
    target_date, target_lesson = week_candidates[0]
    assert target_date == date(2026, 10, 15)
    assert target_lesson == lesson_last_week


def test_due_date_falls_back_to_next_week_only_when_due_week_has_no_pair():
    """Rule 13.1 clause 3: If no pair exists in the due week, binds to first next pair."""
    lesson_this_week = DummyLesson("Основи філософських знань", "Домніна Г.С.", 2)

    # Due week (12-16 Oct) has NO philosophy lessons
    horizon_lessons_by_date = {
        date(2026, 10, 22): [lesson_this_week],
    }
    sorted_horizon_dates = sorted(horizon_lessons_by_date.keys())

    due_date = date(2026, 10, 15)
    due_monday = due_date - (due_date.weekday() * date.resolution)
    due_friday = due_monday + (4 * date.resolution)

    combined_cw_text = "філософія"
    author_tokens = ["домніна"]

    week_candidates = [
        (d, l)
        for d in sorted_horizon_dates
        if due_monday <= d <= due_friday and d in horizon_lessons_by_date
        for l in horizon_lessons_by_date[d]
        if _matches_lesson(l, combined_cw_text, "", author_tokens)
    ]
    assert len(week_candidates) == 0

    next_candidates = [
        (d, l)
        for d in sorted_horizon_dates
        if d > due_friday and d in horizon_lessons_by_date
        for l in horizon_lessons_by_date[d]
        if _matches_lesson(l, combined_cw_text, "", author_tokens)
    ]
    assert len(next_candidates) == 1
    target_date, target_lesson = next_candidates[0]
    assert target_date == date(2026, 10, 22)
    assert target_lesson == lesson_this_week


def test_link_prefix_is_parsed_only_for_teacher_prefixed_lines():
    assert _link_line_prefix("Токарєва: https://meet.google.com/abc-defg-hij") == "Токарєва"
    assert _link_line_prefix("https://meet.google.com/abc-defg-hij") is None


def test_other_subgroup_link_is_preserved_when_other_teacher_syncs():
    # Синхронізує студент 2 підгрупи: у його курсах є лише Хочинська
    sync_tokens = {"хочинська", "олена", "сергіївна"}
    assert _link_line_belongs_to_sync("Хочинська: https://meet.google.com/abc-defg-hij", sync_tokens) is True
    # Посилання Токарєвої (1 підгрупа) НЕ належить цьому синку, його не можна видаляти
    assert _link_line_belongs_to_sync("Токарєва: https://meet.google.com/xyz-uvwx-rst", sync_tokens) is False


def test_link_without_teacher_prefix_is_owned_by_sync_as_before():
    assert _link_line_belongs_to_sync("https://meet.google.com/abc-defg-hij", {"хочинська"}) is True


def test_link_prefix_matches_ru_spelling_in_classroom():
    # У Classroom прізвище може бути «Токарева», а в розкладі «Токарєва»
    assert _link_line_belongs_to_sync("Токарєва: https://zoom.us/j/123", {"токарєва"}) is True
    assert _link_line_belongs_to_sync("Токарєва: https://zoom.us/j/123", {"токарева"}) is True
    assert _link_line_belongs_to_sync("Токарєва: https://zoom.us/j/123", {"хочинська"}) is False


# ---------------------------------------------------------------------------
# Section 25.9: Тести кількох Classroom-акаунтів на групу (v1.6)
# ---------------------------------------------------------------------------

import importlib.util
from pathlib import Path
from unittest.mock import patch
import httpx
from httpx import ASGITransport, AsyncClient
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db
from app.core.crypto import decrypt_token, encrypt_token, is_fernet_ciphertext
from app.models import (
    ClassroomCredential,
    ClassroomGroupBinding,
    Group,
    LessonOccurrenceNote,
    Schedule,
    Subject,
    Teacher,
)
from app.routers import classroom as classroom_router


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def classroom_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    now_kyiv = datetime.now(KYIV_TZ)
    today_real = now_kyiv.date()
    current_monday = today_real - (today_real.weekday() * date.resolution)

    async with sessions() as db:
        group = Group(name="85 ДФКР", is_active=True)
        t_tokareva = Teacher(name="Токарєва Т.О.", full_name="Токарєва Тетяна Олександрівна", is_active=True)
        t_khochynska = Teacher(name="Хочинська О.С.", full_name="Хочинська Олена Сергіївна", is_active=True)
        t_shared = Teacher(name="Домніна Г.С.", full_name="Домніна Галина Сергіївна", is_active=True)
        subj_eng = Subject(name="Іноземна мова", is_active=True)
        subj_phil = Subject(name="Основи філософських знань", is_active=True)
        db.add_all([group, t_tokareva, t_khochynska, t_shared, subj_eng, subj_phil])
        await db.flush()

        # Пара 1 у понеділок: Іноземна мова з 2 викладачами (підгрупи)
        l_eng = Schedule(
            group_id=group.id,
            subject_id=subj_eng.id,
            teacher_id=t_tokareva.id,
            second_teacher_id=t_khochynska.id,
            day_of_week=1,
            lesson_number=1,
            week_type="both",
            is_active=True,
        )
        # Пара 2 у понеділок: Філософія (спільна)
        l_phil = Schedule(
            group_id=group.id,
            subject_id=subj_phil.id,
            teacher_id=t_shared.id,
            day_of_week=1,
            lesson_number=2,
            week_type="both",
            is_active=True,
        )
        db.add_all([l_eng, l_phil])
        await db.commit()
        state = {
            "group_id": group.id,
            "t_tokareva_id": t_tokareva.id,
            "t_khochynska_id": t_khochynska.id,
            "subj_eng_id": subj_eng.id,
            "subj_phil_id": subj_phil.id,
            "monday": current_monday,
            "sessions": sessions,
        }

    async def override_db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    classroom_router._latest_group_tasks.clear()
    classroom_router._latest_unmapped_tasks.clear()
    classroom_router._sync_backoff_state.clear()
    classroom_router._SYNC_LOCK_GROUPS.clear()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, state
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def _make_fake_google_transport(
    courses_by_token: dict[str, list[dict]],
    profiles_by_token: dict[str, dict],
    teachers_by_course: dict[str, list[dict]],
    announcements_by_course: dict[str, list[dict]],
    coursework_by_course: dict[str, list[dict]],
    submissions_by_token_course: Optional[dict[tuple[str, str], list[dict]]] = None,
    token_refresh_map: Optional[dict[str, tuple[int, dict]]] = None,
    courses_status_by_token: Optional[dict[str, int]] = None,
    call_counter: Optional[dict[str, int]] = None,
) -> httpx.MockTransport:
    submissions_by_token_course = submissions_by_token_course or {}
    token_refresh_map = token_refresh_map or {}
    courses_status_by_token = courses_status_by_token or {}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        auth = request.headers.get("Authorization", "")
        token = auth.replace("Bearer ", "").strip()

        if call_counter is not None:
            call_counter[url] = call_counter.get(url, 0) + 1

        if "oauth2.googleapis.com/token" in url:
            body_str = request.content.decode("utf-8")
            for rt, (st_code, payload) in token_refresh_map.items():
                from urllib.parse import quote_plus
                if f"refresh_token={rt}" in body_str or f"refresh_token={quote_plus(rt)}" in body_str:
                    return httpx.Response(st_code, json=payload)
            return httpx.Response(400, json={"error": "invalid_grant"})

        if "oauth2.googleapis.com/revoke" in url:
            return httpx.Response(200, json={})

        if url.endswith("/v1/userProfiles/me"):
            prof = profiles_by_token.get(token)
            if prof:
                return httpx.Response(200, json=prof)
            return httpx.Response(401, json={"error": "unauthorized"})

        if "/v1/courses?" in url or url.endswith("/v1/courses"):
            st = courses_status_by_token.get(token, 200)
            if st != 200:
                return httpx.Response(st, json={"error": f"http_{st}"})
            return httpx.Response(200, json={"courses": courses_by_token.get(token, [])})

        for c_id in set(teachers_by_course) | set(announcements_by_course) | set(coursework_by_course):
            if f"/v1/courses/{c_id}/teachers" in url:
                if call_counter is not None:
                    call_counter[f"course_bundle:{c_id}"] = call_counter.get(f"course_bundle:{c_id}", 0) + 1
                return httpx.Response(200, json={"teachers": teachers_by_course.get(c_id, [])})
            if f"/v1/courses/{c_id}/announcements" in url:
                return httpx.Response(200, json={"announcements": announcements_by_course.get(c_id, [])})
            if f"/v1/courses/{c_id}/courseWork/" in url and "studentSubmissions" in url:
                subs = submissions_by_token_course.get((token, c_id), [])
                return httpx.Response(200, json={"studentSubmissions": subs})
            if f"/v1/courses/{c_id}/courseWorkMaterials" in url:
                return httpx.Response(200, json={"courseWorkMaterial": []})
            if f"/v1/courses/{c_id}/courseWork" in url:
                return httpx.Response(200, json={"courseWork": coursework_by_course.get(c_id, [])})
            if f"/v1/courses/{c_id}/topics" in url:
                return httpx.Response(200, json={"topic": []})
            if f"/v1/courses/{c_id}/students" in url:
                return httpx.Response(200, json={"students": []})

        if "people.googleapis.com" in url:
            return httpx.Response(200, json={"people": []})

        return httpx.Response(404, json={})

    return httpx.MockTransport(handler)


@pytest.mark.anyio
async def test_two_students_connect_sequentially_both_credentials_saved_and_encrypted(classroom_db, caplog):
    """
    25.9.1 & 25.10: Два студенти однієї групи підключаються по черзі — в БД є два активні записи,
    токени зашифровані Fernet, у логах немає відкритих токенів.
    """
    client, state = classroom_db
    monday: date = state["monday"]
    monday_iso = f"{monday.isoformat()}T08:00:00Z"

    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.secret_tok_student_1": [
                {"id": "101", "name": "Іноземна мова 85 ДФКР (1 підгрупа)"},
            ],
            "ya29.secret_tok_student_2": [
                {"id": "102", "name": "Іноземна мова 85 ДФКР (2 підгрупа)"},
            ],
        },
        profiles_by_token={
            "ya29.secret_tok_student_1": {"id": "google_uid_111", "emailAddress": "student1@kre.dp.ua"},
            "ya29.secret_tok_student_2": {"id": "google_uid_222", "emailAddress": "student2@kre.dp.ua"},
        },
        teachers_by_course={
            "101": [{"userId": "t1", "profile": {"name": {"fullName": "Токарєва Тетяна Олександрівна"}}}],
            "102": [{"userId": "t2", "profile": {"name": {"fullName": "Хочинська Олена Сергіївна"}}}],
        },
        announcements_by_course={
            "101": [{"text": "Пара на 1 пару: https://meet.google.com/tok-aaaa-bbb", "creationTime": monday_iso, "creatorUserId": "t1"}],
            "102": [{"text": "Пара на 1 пару: https://meet.google.com/kho-cccc-ddd", "creationTime": monday_iso, "creatorUserId": "t2"}],
        },
        coursework_by_course={"101": [], "102": []},
    )

    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        resp1 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.secret_tok_student_1",
                "refresh_token": "1//secret_rt_student_1",
                "group_id": state["group_id"],
                "week_start": monday.isoformat(),
            },
        )
        assert resp1.status_code == 200, resp1.text
        assert resp1.json()["google_user_id"] == "google_uid_111"

        resp2 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.secret_tok_student_2",
                "refresh_token": "1//secret_rt_student_2",
                "group_id": state["group_id"],
                "week_start": monday.isoformat(),
            },
        )
        assert resp2.status_code == 200, resp2.text
        assert resp2.json()["google_user_id"] == "google_uid_222"

        # Перевірка повторного входу першого студента (upsert, не створює 3-й запис)
        resp1_again = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.secret_tok_student_1",
                "refresh_token": "1//secret_rt_student_1_updated",
                "group_id": state["group_id"],
                "week_start": monday.isoformat(),
            },
        )
        assert resp1_again.status_code == 200

    async with state["sessions"]() as db:
        creds = (
            await db.scalars(
                select(ClassroomCredential)
                .where(ClassroomCredential.group_id == state["group_id"])
                .order_by(ClassroomCredential.google_user_id.asc())
            )
        ).all()
        assert len(creds) == 2
        assert [c.google_user_id for c in creds] == ["google_uid_111", "google_uid_222"]
        assert all(c.is_active for c in creds)

        # Токени в БД строго зашифровані Fernet (не рівні відкритому тексту)
        assert creds[0].refresh_token != "1//secret_rt_student_1_updated"
        assert is_fernet_ciphertext(creds[0].refresh_token)
        assert decrypt_token(creds[0].refresh_token) == "1//secret_rt_student_1_updated"

        assert creds[1].refresh_token != "1//secret_rt_student_2"
        assert is_fernet_ciphertext(creds[1].refresh_token)
        assert decrypt_token(creds[1].refresh_token) == "1//secret_rt_student_2"

    # У логах немає відкритих токенів
    log_text = caplog.text
    assert "ya29.secret_tok_student_1" not in log_text
    assert "1//secret_rt_student_1" not in log_text
    assert "1//secret_rt_student_2" not in log_text


@pytest.mark.anyio
async def test_background_sync_updates_both_subgroups_and_deduplicates_shared_course(classroom_db):
    """
    25.9.2 & 25.5: Фоновий синк з обома акаунтами (фейковий Google API) — у нотатках парі
    з двома викладачами є посилання і завдання обох підгруп; спільний курс читається лише 1 раз за цикл.
    Також перевіряється 25.6: стан здачі (TURNED_IN) одного студента не записує [TASKS_COMPLETED] у спільні нотатки.
    """
    client, state = classroom_db
    monday: date = state["monday"]
    monday_iso = f"{monday.isoformat()}T08:00:00Z"

    old_sync_1 = datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc)
    old_sync_2 = datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc)

    async with state["sessions"]() as db:
        db.add_all([
            ClassroomCredential(
                group_id=state["group_id"],
                google_user_id="uid_sub1",
                refresh_token=encrypt_token("1//rt_sub1"),
                last_synced_at=old_sync_1,
                is_active=True,
            ),
            ClassroomCredential(
                group_id=state["group_id"],
                google_user_id="uid_sub2",
                refresh_token=encrypt_token("1//rt_sub2"),
                last_synced_at=old_sync_2,
                is_active=True,
            ),
        ])
        await db.commit()

    call_counter: dict[str, int] = {}
    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.fresh_sub1": [
                {"id": "101", "name": "Іноземна мова 85 ДФКР (1 підгр)"},
                {"id": "999", "name": "Основи філософських знань 85 ДФКР"},
            ],
            "ya29.fresh_sub2": [
                {"id": "102", "name": "Іноземна мова 85 ДФКР (2 підгр)"},
                {"id": "999", "name": "Основи філософських знань 85 ДФКР"},
            ],
        },
        profiles_by_token={
            "ya29.fresh_sub1": {"id": "uid_sub1", "emailAddress": "s1@kre.dp.ua"},
            "ya29.fresh_sub2": {"id": "uid_sub2", "emailAddress": "s2@kre.dp.ua"},
        },
        teachers_by_course={
            "101": [{"userId": "t1", "profile": {"name": {"fullName": "Токарєва Тетяна Олександрівна"}}}],
            "102": [{"userId": "t2", "profile": {"name": {"fullName": "Хочинська Олена Сергіївна"}}}],
            "999": [{"userId": "t3", "profile": {"name": {"fullName": "Домніна Галина Сергіївна"}}}],
        },
        announcements_by_course={
            "101": [{"text": f"Заняття {monday.strftime('%d.%m')} на 1 пару: https://meet.google.com/tok-sub1-link", "creationTime": monday_iso, "creatorUserId": "t1"}],
            "102": [{"text": f"Заняття {monday.strftime('%d.%m')} на 1 пару: https://meet.google.com/kho-sub2-link", "creationTime": monday_iso, "creatorUserId": "t2"}],
            "999": [{"text": f"Лекція {monday.strftime('%d.%m')} на 2 пару: https://meet.google.com/phil-shared-link", "creationTime": monday_iso, "creatorUserId": "t3"}],
        },
        coursework_by_course={
            "101": [{
                "id": "cw101",
                "title": "Граматичний тест 1",
                "alternateLink": "https://classroom.google.com/c/101/a/111/details",
                "creationTime": monday_iso,
                "dueDate": {"year": monday.year, "month": monday.month, "day": monday.day},
                "creatorUserId": "t1",
            }],
            "102": [{
                "id": "cw102",
                "title": "Есе 2 підгрупа",
                "alternateLink": "https://classroom.google.com/c/102/a/222/details",
                "creationTime": monday_iso,
                "dueDate": {"year": monday.year, "month": monday.month, "day": monday.day},
                "creatorUserId": "t2",
            }],
            "999": [],
        },
        # Студент 1 вже здав своє завдання (TURNED_IN) — воно все одно мусить бути в спільних нотатках групи!
        submissions_by_token_course={
            ("ya29.fresh_sub1", "101"): [{"courseWorkId": "cw101", "state": "TURNED_IN", "assignedGrade": 12}],
        },
        token_refresh_map={
            "1//rt_sub1": (200, {"access_token": "ya29.fresh_sub1"}),
            "1//rt_sub2": (200, {"access_token": "ya29.fresh_sub2"}),
        },
        call_counter=call_counter,
    )

    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client), \
         patch.object(classroom_router.settings, "google_client_secret", "test_secret"), \
         patch.object(classroom_router.settings, "google_client_id", "test_client_id"):
        async with state["sessions"]() as db:
            await classroom_router.trigger_background_sync_if_needed(
                db, state["group_id"], force=True
            )

    # Перевіряємо дедуплікацію: спільний курс 999 читався лише ОДИН раз за цикл!
    assert call_counter.get("course_bundle:101") == 1
    assert call_counter.get("course_bundle:102") == 1
    assert call_counter.get("course_bundle:999") == 1

    async with state["sessions"]() as db:
        eng_note = await db.scalar(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id == state["group_id"],
                LessonOccurrenceNote.note_date == monday,
                LessonOccurrenceNote.lesson_number == 1,
                LessonOccurrenceNote.archived.is_(False),
            )
        )
        assert eng_note is not None
        # Обидва посилання обох викладачів присутні в нотатці пари
        assert "Токарєва: https://meet.google.com/tok-sub1-link" in eng_note.note
        assert "Хочинська: https://meet.google.com/kho-sub2-link" in eng_note.note
        # Обидва завдання обох підгруп присутні в нотатці пари (навіть те, що студент 1 вже здав!)
        assert "Граматичний тест 1" in eng_note.note
        assert "Есе 2 підгрупа" in eng_note.note
        # Службова нотатка [TASKS_COMPLETED] ніколи не записується в спільні нотатки (25.6)
        assert "[TASKS_COMPLETED]" not in eng_note.note

        # Спільна пара (Філософія, 2 пара) також зберегла своє посилання після дедуплікації у 2-го акаунта
        phil_note = await db.scalar(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id == state["group_id"],
                LessonOccurrenceNote.note_date == monday,
                LessonOccurrenceNote.lesson_number == 2,
                LessonOccurrenceNote.archived.is_(False),
            )
        )
        assert phil_note is not None
        assert "https://meet.google.com/phil-shared-link" in phil_note.note


@pytest.mark.anyio
async def test_perform_course_sync_returns_personal_teachers_and_subgroup(classroom_db):
    """
    Перевіряємо, що perform_course_sync повертає персональних викладачів та підгрупу студента
    для коректного персонального відображення в застосунку.
    """
    _, state = classroom_db
    courses = [
        {"id": "101", "name": "Іноземна мова 85 ДФКР (1 підгр)"},
    ]
    transport = _make_fake_google_transport(
        courses_by_token={"ya29.sub1": courses},
        profiles_by_token={"ya29.sub1": {"id": "uid_sub1", "emailAddress": "s1@kre.dp.ua"}},
        teachers_by_course={
            "101": [{"userId": "t1", "profile": {"name": {"fullName": "Токарєва Тетяна Олександрівна"}}}],
        },
        announcements_by_course={},
        coursework_by_course={},
    )
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        async with state["sessions"]() as db:
            from app.models.entities import Group
            group = await db.get(Group, state["group_id"])
            res = await classroom_router.perform_course_sync(
                db, group, courses, "ya29.sub1"
            )
            assert 1 in res["synced_subgroups"]
            assert any("токар" in t for t in res["synced_teacher_tokens"])
            assert any("Токарєва" in name for name in res["synced_teacher_names"])


@pytest.mark.anyio
async def test_invalid_grant_deactivates_only_failing_account_and_429_sets_backoff(classroom_db):
    """
    25.9.3 & 25.5: Відмова одного токена (invalid_grant або 401/429) — інший акаунт
    відпрацьовує нормально, зламаний отримує backoff або is_active = false.
    """
    _, state = classroom_db
    monday: date = state["monday"]
    monday_iso = f"{monday.isoformat()}T08:00:00Z"

    old_sync = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    async with state["sessions"]() as db:
        db.add_all([
            ClassroomCredential(
                group_id=state["group_id"],
                google_user_id="uid_revoked",
                refresh_token=encrypt_token("1//rt_revoked"),
                last_synced_at=old_sync,
                is_active=True,
            ),
            ClassroomCredential(
                group_id=state["group_id"],
                google_user_id="uid_healthy",
                refresh_token=encrypt_token("1//rt_healthy"),
                last_synced_at=old_sync,
                is_active=True,
            ),
        ])
        await db.commit()

    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.healthy_tok": [{"id": "102", "name": "Іноземна мова 85 ДФКР (2 підгр)"}],
        },
        profiles_by_token={
            "ya29.healthy_tok": {"id": "uid_healthy", "emailAddress": "ok@kre.dp.ua"},
        },
        teachers_by_course={
            "102": [{"userId": "t2", "profile": {"name": {"fullName": "Хочинська Олена Сергіївна"}}}],
        },
        announcements_by_course={
            "102": [{"text": f"Заняття {monday.strftime('%d.%m')} на 1 пару: https://meet.google.com/kho-ok-link", "creationTime": monday_iso, "creatorUserId": "t2"}],
        },
        coursework_by_course={"102": []},
        token_refresh_map={
            "1//rt_revoked": (400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."}),
            "1//rt_healthy": (200, {"access_token": "ya29.healthy_tok"}),
        },
    )

    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client), \
         patch.object(classroom_router.settings, "google_client_secret", "test_secret"), \
         patch.object(classroom_router.settings, "google_client_id", "test_client_id"):
        async with state["sessions"]() as db:
            await classroom_router.trigger_background_sync_if_needed(
                db, state["group_id"], force=True
            )

    async with state["sessions"]() as db:
        revoked_cred = await db.scalar(
            select(ClassroomCredential).where(ClassroomCredential.google_user_id == "uid_revoked")
        )
        healthy_cred = await db.scalar(
            select(ClassroomCredential).where(ClassroomCredential.google_user_id == "uid_healthy")
        )
        assert revoked_cred is not None
        assert revoked_cred.is_active is False
        assert revoked_cred.fail_count == 1
        assert "invalid_grant" in (revoked_cred.last_error or "")

        assert healthy_cred is not None
        assert healthy_cred.is_active is True
        assert healthy_cred.fail_count == 0
        assert healthy_cred.last_error is None
        h_ts = (
            healthy_cred.last_synced_at
            if healthy_cred.last_synced_at.tzinfo
            else healthy_cred.last_synced_at.replace(tzinfo=timezone.utc)
        )
        assert h_ts > old_sync

        # Тепер перевіримо 429 Too Many Requests для активного акаунта -> отримує backoff, але лишається is_active=True
        healthy_cred.last_synced_at = old_sync
        await db.commit()

    transport_429 = _make_fake_google_transport(
        courses_by_token={},
        profiles_by_token={},
        teachers_by_course={},
        announcements_by_course={},
        coursework_by_course={},
        token_refresh_map={
            "1//rt_healthy": (200, {"access_token": "ya29.healthy_tok"}),
        },
        courses_status_by_token={"ya29.healthy_tok": 429},
    )

    def mocked_client_429(*args, **kwargs):
        kwargs["transport"] = transport_429
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client_429), \
         patch.object(classroom_router.settings, "google_client_secret", "test_secret"), \
         patch.object(classroom_router.settings, "google_client_id", "test_client_id"):
        async with state["sessions"]() as db:
            await classroom_router.trigger_background_sync_if_needed(
                db, state["group_id"], force=True
            )

    async with state["sessions"]() as db:
        healthy_cred = await db.scalar(
            select(ClassroomCredential).where(ClassroomCredential.google_user_id == "uid_healthy")
        )
        assert healthy_cred.is_active is True
        assert healthy_cred.fail_count == 1
        assert healthy_cred.next_attempt_at is not None
        assert "429" in (healthy_cred.last_error or "")


@pytest.mark.anyio
async def test_disconnect_deletes_only_one_student_and_revokes_token(classroom_db):
    """
    25.6: «Від'єднати» видаляє запис цього студента і відкликає його токен у Google.
    Інші записи групи не зачіпаються.
    """
    client, state = classroom_db
    async with state["sessions"]() as db:
        db.add_all([
            ClassroomCredential(
                group_id=state["group_id"],
                google_user_id="uid_1",
                refresh_token=encrypt_token("1//rt_student_1"),
                is_active=True,
            ),
            ClassroomCredential(
                group_id=state["group_id"],
                google_user_id="uid_2",
                refresh_token=encrypt_token("1//rt_student_2"),
                is_active=True,
            ),
        ])
        await db.commit()

    revoked_tokens: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "oauth2.googleapis.com/revoke" in str(request.url):
            tok = request.url.params.get("token", "")
            revoked_tokens.append(tok)
            return httpx.Response(200, json={})
        return httpx.Response(200, json={})

    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        resp = await client.post(
            "/api/classroom/disconnect",
            json={
                "group_id": state["group_id"],
                "google_user_id": "uid_1",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted_credentials"] == 1
        assert data["revoked"] is True

    assert "1//rt_student_1" in revoked_tokens
    assert "1//rt_student_2" not in revoked_tokens

    async with state["sessions"]() as db:
        remaining = (
            await db.scalars(
                select(ClassroomCredential).where(ClassroomCredential.group_id == state["group_id"])
            )
        ).all()
        assert len(remaining) == 1
        assert remaining[0].google_user_id == "uid_2"


def test_alembic_migration_copies_and_encrypts_legacy_binding_token():
    """
    25.9.4: Міграція переносить старий токен із classroom_group_bindings у classroom_credentials
    (із шифруванням Fernet) і не ламає відкат.
    """
    path = Path(__file__).parents[1] / "alembic/versions/20261021_classroom_credentials.py"
    spec = importlib.util.spec_from_file_location("cred_migration", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as conn:
            old_tables = [t for t in Base.metadata.sorted_tables if t.name != "classroom_credentials"]
            Base.metadata.create_all(conn, tables=old_tables)

            conn.execute(
                text(
                    "INSERT INTO groups (id, name, is_active, updated_at) "
                    "VALUES (85, '85 ДФКР', 1, CURRENT_TIMESTAMP)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO classroom_group_bindings "
                    "(group_id, course_id, course_name, refresh_token, last_synced_at, is_active) "
                    "VALUES (85, 'c85', 'Курс 85', '1//legacy_plaintext_refresh_token', CURRENT_TIMESTAMP, 1)"
                )
            )

            with Operations.context(MigrationContext.configure(conn)):
                mod.upgrade()

            assert "classroom_credentials" in inspect(conn).get_table_names()
            row = conn.execute(
                text("SELECT group_id, google_user_id, refresh_token, is_active FROM classroom_credentials")
            ).fetchone()
            assert row is not None
            assert row[0] == 85
            assert row[1] == "legacy_group_85"
            assert row[2] != "1//legacy_plaintext_refresh_token"
            assert is_fernet_ciphertext(row[2])
            assert decrypt_token(row[2]) == "1//legacy_plaintext_refresh_token"
            assert bool(row[3]) is True

            # Стара таблиця лишається недоторканою
            old_count = conn.scalar(text("SELECT COUNT(*) FROM classroom_group_bindings WHERE group_id = 85"))
            assert old_count == 1

            # Відкат міграції не падає і залишає classroom_group_bindings цілою
            with Operations.context(MigrationContext.configure(conn)):
                mod.downgrade()
            assert "classroom_credentials" not in inspect(conn).get_table_names()
            assert conn.scalar(text("SELECT COUNT(*) FROM classroom_group_bindings WHERE group_id = 85")) == 1
    finally:
        engine.dispose()


def test_resolve_matched_teacher_surname_latin_and_subgroup_labels():
    class DummyDualLesson:
        def __init__(self):
            self.teacher_name = "Токарєва Т.В. / Хочинська Л.О."
            self.second_teacher_id = 2

    lesson = DummyDualLesson()

    # Subgroup keywords in course title
    assert classroom_router._resolve_matched_teacher_surname(lesson, [], "іноземна мова 1 підгрупа") == "Токарєва"
    assert classroom_router._resolve_matched_teacher_surname(lesson, [], "англійська мова 2 підгрупа") == "Хочинська"
    assert classroom_router._resolve_matched_teacher_surname(lesson, [], "1-ша підгрупа англійська") == "Токарєва"
    assert classroom_router._resolve_matched_teacher_surname(lesson, [], "2-га підгрупа англійська") == "Хочинська"

    # Latin spelling in Google account profile
    assert classroom_router._resolve_matched_teacher_surname(lesson, ["tokareva"], "") == "Токарєва"
    assert classroom_router._resolve_matched_teacher_surname(lesson, ["khochynska"], "") == "Хочинська"

    # Russian 'e' in Google account profile
    assert classroom_router._resolve_matched_teacher_surname(lesson, ["токарева"], "") == "Токарєва"


def test_link_line_prefix_handles_brackets_and_subgroups():
    assert classroom_router._link_line_prefix("[Токарєва]: https://meet.google.com/abc") == "Токарєва"
    assert classroom_router._link_line_prefix("[Токарєва] https://meet.google.com/abc") == "Токарєва"
    assert classroom_router._link_line_prefix("Токарєва Т.В.: https://meet.google.com/abc") == "Токарєва Т.В."
    assert classroom_router._link_line_prefix("1 підгрупа: https://meet.google.com/abc") == "1 підгрупа"
    assert classroom_router._link_line_prefix("2 підгрупа: https://zoom.us/j/123") == "2 підгрупа"
    assert classroom_router._link_line_prefix("https://meet.google.com/abc") is None


@pytest.mark.anyio
async def test_sequential_subgroup_syncs_preserve_both_links_and_tasks(classroom_db):
    """
    Simulates:
    1. Student 1 (subgroup 1, Tokareva) syncs via POST /api/classroom/sync.
    2. Student 2 (subgroup 2, Khochynska) syncs via POST /api/classroom/sync.
    3. Student 1 syncs again via POST /api/classroom/sync.
    Verifies that NEITHER student wipes out the other's link or coursework.
    """
    client, state = classroom_db
    monday: date = state["monday"]
    monday_iso = f"{monday.isoformat()}T08:00:00Z"

    call_counter: dict[str, int] = {}
    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.tok_student_1": [
                {"id": "101", "name": "Іноземна мова 85 ДФКР (1 підгр)"},
            ],
            "ya29.tok_student_2": [
                {"id": "102", "name": "Іноземна мова 85 ДФКР (2 підгр)"},
            ],
        },
        profiles_by_token={
            "ya29.tok_student_1": {"id": "uid_s1", "emailAddress": "s1@kre.dp.ua"},
            "ya29.tok_student_2": {"id": "uid_s2", "emailAddress": "s2@kre.dp.ua"},
        },
        teachers_by_course={
            "101": [{"userId": "t1", "profile": {"name": {"fullName": "Токарєва Тетяна Олександрівна"}}}],
            "102": [{"userId": "t2", "profile": {"name": {"fullName": "Хочинська Олена Сергіївна"}}}],
        },
        announcements_by_course={
            "101": [{"text": f"Заняття {monday.strftime('%d.%m')} на 1 пару: https://meet.google.com/tok-seq-1", "creationTime": monday_iso, "creatorUserId": "t1"}],
            "102": [{"text": f"Заняття {monday.strftime('%d.%m')} на 1 пару: https://meet.google.com/kho-seq-2", "creationTime": monday_iso, "creatorUserId": "t2"}],
        },
        coursework_by_course={
            "101": [{
                "id": "cw_seq_1",
                "title": "Граматика 1",
                "alternateLink": "https://classroom.google.com/c/101/a/111/details",
                "creationTime": monday_iso,
                "dueDate": {"year": monday.year, "month": monday.month, "day": monday.day},
                "creatorUserId": "t1",
            }],
            "102": [{
                "id": "cw_seq_2",
                "title": "Есе 2",
                "alternateLink": "https://classroom.google.com/c/102/a/222/details",
                "creationTime": monday_iso,
                "dueDate": {"year": monday.year, "month": monday.month, "day": monday.day},
                "creatorUserId": "t2",
            }],
        },
        token_refresh_map={
            "1//rt_seq_1": (200, {"access_token": "ya29.tok_student_1"}),
            "1//rt_seq_2": (200, {"access_token": "ya29.tok_student_2"}),
        },
        call_counter=call_counter,
    )

    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client), \
         patch.object(classroom_router.settings, "google_client_secret", "test_secret"), \
         patch.object(classroom_router.settings, "google_client_id", "test_client_id"):

        # 1. Студент 1 синхронізує
        resp1 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.tok_student_1",
                "refresh_token": "1//rt_seq_1",
                "group_id": state["group_id"],
                "week_start": monday.isoformat(),
            },
        )
        assert resp1.status_code == 200

        # 2. Студент 2 синхронізує
        resp2 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.tok_student_2",
                "refresh_token": "1//rt_seq_2",
                "group_id": state["group_id"],
                "week_start": monday.isoformat(),
            },
        )
        assert resp2.status_code == 200
        # tasks у відповіді містить завдання ОБОХ підгруп
        r2_tasks = resp2.json()["tasks"]
        r2_titles = [t["title"] for t in r2_tasks]
        assert "Граматика 1" in r2_titles
        assert "Есе 2" in r2_titles

        # Перевірка БД після 2-го синку: обидва посилання і обидва ДЗ на місці
        async with state["sessions"]() as db:
            eng_note = await db.scalar(
                select(LessonOccurrenceNote).where(
                    LessonOccurrenceNote.group_id == state["group_id"],
                    LessonOccurrenceNote.note_date == monday,
                    LessonOccurrenceNote.lesson_number == 1,
                    LessonOccurrenceNote.archived.is_(False),
                )
            )
            assert eng_note is not None
            assert "Токарєва: https://meet.google.com/tok-seq-1" in eng_note.note
            assert "Хочинська: https://meet.google.com/kho-seq-2" in eng_note.note
            assert "Граматика 1" in eng_note.note
            assert "Есе 2" in eng_note.note

        # 3. Студент 1 синхронізує знову — посилання і ДЗ 2-ї підгрупи не зникають!
        resp3 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.tok_student_1",
                "refresh_token": "1//rt_seq_1",
                "group_id": state["group_id"],
                "week_start": monday.isoformat(),
            },
        )
        assert resp3.status_code == 200
        r3_tasks = resp3.json()["tasks"]
        r3_titles = [t["title"] for t in r3_tasks]
        assert "Граматика 1" in r3_titles
        assert "Есе 2" in r3_titles

        async with state["sessions"]() as db:
            eng_note_after = await db.scalar(
                select(LessonOccurrenceNote).where(
                    LessonOccurrenceNote.group_id == state["group_id"],
                    LessonOccurrenceNote.note_date == monday,
                    LessonOccurrenceNote.lesson_number == 1,
                    LessonOccurrenceNote.archived.is_(False),
                )
            )
            assert eng_note_after is not None
            assert "Токарєва: https://meet.google.com/tok-seq-1" in eng_note_after.note
            assert "Хочинська: https://meet.google.com/kho-seq-2" in eng_note_after.note
            assert "Граматика 1" in eng_note_after.note
            assert "Есе 2" in eng_note_after.note


@pytest.mark.anyio
async def test_shared_single_course_with_two_teachers_targets_specific_students(classroom_db):
    """
    Реальний кейс: один спільний курс ("101", "Іноземна мова 85 ДФКР"), де записані ОБИДВА викладачі
    (Токарєва і Хочинська) та всі студенти групи, а викладачі публікують посилання і ДЗ,
    вибираючи конкретних студентів своєї підгрупи.
    Перевіряємо:
    1) Студент 1 отримує лише свою підгрупу (1), свого викладача (Токарєва) та своє ДЗ у personal_tasks.
    2) Студент 2 отримує лише свою підгрупу (2), свого викладача (Хочинська) та своє ДЗ у personal_tasks.
    3) У БД та загальному списку групи зберігаються ОБИДВА посилання і ОБИДВА ДЗ для неавторизованих користувачів,
       не перезаписуючи одне одного ні при ручному, ні при фоновому синку.
    """
    client, state = classroom_db
    monday: date = state["monday"]
    monday_iso = f"{monday.isoformat()}T08:00:00Z"

    shared_courses = [{"id": "101", "name": "Іноземна мова 85 ДФКР"}]
    shared_teachers = [
        {"userId": "t1", "profile": {"name": {"fullName": "Токарєва Тетяна Олександрівна"}}},
        {"userId": "t2", "profile": {"name": {"fullName": "Хочинська Олена Сергіївна"}}},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        auth = request.headers.get("Authorization", "")
        token = auth.replace("Bearer ", "").strip()

        if "oauth2.googleapis.com/token" in url:
            body = request.content.decode("utf-8", errors="ignore")
            if "rt_shared_1" in body:
                return httpx.Response(200, json={"access_token": "ya29.shared_s1"})
            if "rt_shared_2" in body:
                return httpx.Response(200, json={"access_token": "ya29.shared_s2"})
            return httpx.Response(400, json={"error": "invalid_grant"})

        if url.endswith("/v1/userProfiles/me"):
            if token == "ya29.shared_s1":
                return httpx.Response(200, json={"id": "uid_shared_1", "emailAddress": "s1@kre.dp.ua"})
            if token == "ya29.shared_s2":
                return httpx.Response(200, json={"id": "uid_shared_2", "emailAddress": "s2@kre.dp.ua"})

        if "/v1/courses" in url and "/teachers" not in url and "/announcements" not in url and "/courseWork" not in url and "/topics" not in url and "/students" not in url:
            return httpx.Response(200, json={"courses": shared_courses})

        if "/v1/courses/101/teachers" in url:
            return httpx.Response(200, json={"teachers": shared_teachers})

        if "/v1/courses/101/announcements" in url:
            if token == "ya29.shared_s1":
                return httpx.Response(200, json={"announcements": [
                    {"text": f"Пара {monday.strftime('%d.%m')} на 1 пару: https://meet.google.com/tok-shared-1", "creationTime": monday_iso, "creatorUserId": "t1"}
                ]})
            if token == "ya29.shared_s2":
                return httpx.Response(200, json={"announcements": [
                    {"text": f"Пара {monday.strftime('%d.%m')} на 1 пару: https://meet.google.com/kho-shared-2", "creationTime": monday_iso, "creatorUserId": "t2"}
                ]})

        if "/v1/courses/101/courseWork/" in url and "studentSubmissions" in url:
            return httpx.Response(200, json={"studentSubmissions": []})

        if "/v1/courses/101/courseWorkMaterials" in url:
            return httpx.Response(200, json={"courseWorkMaterial": []})

        if "/v1/courses/101/courseWork" in url:
            if token == "ya29.shared_s1":
                return httpx.Response(200, json={"courseWork": [{
                    "id": "cw_shared_1",
                    "title": "ДЗ Підгрупа Токарєвої",
                    "alternateLink": "https://classroom.google.com/c/101/a/111/details",
                    "creationTime": monday_iso,
                    "dueDate": {"year": monday.year, "month": monday.month, "day": monday.day},
                    "creatorUserId": "t1",
                }]})
            if token == "ya29.shared_s2":
                return httpx.Response(200, json={"courseWork": [{
                    "id": "cw_shared_2",
                    "title": "ДЗ Підгрупа Хочинської",
                    "alternateLink": "https://classroom.google.com/c/101/a/222/details",
                    "creationTime": monday_iso,
                    "dueDate": {"year": monday.year, "month": monday.month, "day": monday.day},
                    "creatorUserId": "t2",
                }]})

        if "/v1/courses/101/topics" in url:
            return httpx.Response(200, json={"topic": []})
        if "/v1/courses/101/students" in url:
            return httpx.Response(200, json={"students": []})
        if "people.googleapis.com" in url:
            return httpx.Response(200, json={"people": []})

        return httpx.Response(404, json={})

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client), \
         patch.object(classroom_router.settings, "google_client_secret", "test_secret"), \
         patch.object(classroom_router.settings, "google_client_id", "test_client_id"):

        # 1. Студент 1 логіниться
        r1 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.shared_s1",
                "refresh_token": "1//rt_shared_1",
                "group_id": state["group_id"],
                "week_start": monday.isoformat(),
            },
        )
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["synced_subgroups"] == [1]
        assert any("Токарєва" in n for n in d1["synced_teacher_names"])
        assert not any("Хочинська" in n for n in d1["synced_teacher_names"])
        assert [t["title"] for t in d1["personal_tasks"]] == ["ДЗ Підгрупа Токарєвої"]

        # 2. Студент 2 логіниться
        r2 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.shared_s2",
                "refresh_token": "1//rt_shared_2",
                "group_id": state["group_id"],
                "week_start": monday.isoformat(),
            },
        )
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["synced_subgroups"] == [2]
        assert any("Хочинська" in n for n in d2["synced_teacher_names"])
        assert not any("Токарєва" in n for n in d2["synced_teacher_names"])
        assert [t["title"] for t in d2["personal_tasks"]] == ["ДЗ Підгрупа Хочинської"]

        # Загальний список завдань групи (для неавторизованих) містить ОБИДВА ДЗ
        group_titles = [t["title"] for t in d2["tasks"]]
        assert "ДЗ Підгрупа Токарєвої" in group_titles
        assert "ДЗ Підгрупа Хочинської" in group_titles

        # У БД збереглися ОБИДВА посилання і ОБИДВА ДЗ
        async with state["sessions"]() as db:
            eng_note = await db.scalar(
                select(LessonOccurrenceNote).where(
                    LessonOccurrenceNote.group_id == state["group_id"],
                    LessonOccurrenceNote.note_date == monday,
                    LessonOccurrenceNote.lesson_number == 1,
                    LessonOccurrenceNote.archived.is_(False),
                )
            )
            assert eng_note is not None
            assert "Токарєва: https://meet.google.com/tok-shared-1" in eng_note.note
            assert "Хочинська: https://meet.google.com/kho-shared-2" in eng_note.note
            assert "[TASK] [Токарєва] ДЗ Підгрупа Токарєвої" in eng_note.note
            assert "[TASK] [Хочинська] ДЗ Підгрупа Хочинської" in eng_note.note

            # 3. Фоновий синк обох акаунтів на спільному курсі "101" не пропускає 2-й акаунт і зберігає обидві підгрупи
            await classroom_router.trigger_background_sync_if_needed(
                db, state["group_id"], force=True
            )

            eng_note_bg = await db.scalar(
                select(LessonOccurrenceNote).where(
                    LessonOccurrenceNote.group_id == state["group_id"],
                    LessonOccurrenceNote.note_date == monday,
                    LessonOccurrenceNote.lesson_number == 1,
                    LessonOccurrenceNote.archived.is_(False),
                )
            )
            assert eng_note_bg is not None
            assert "Токарєва: https://meet.google.com/tok-shared-1" in eng_note_bg.note
            assert "Хочинська: https://meet.google.com/kho-shared-2" in eng_note_bg.note
            assert "[TASK] [Токарєва] ДЗ Підгрупа Токарєвої" in eng_note_bg.note
            assert "[TASK] [Хочинська] ДЗ Підгрупа Хочинської" in eng_note_bg.note


@pytest.mark.anyio
async def test_crypto_multi_key_fallback_decryption():
    """Verify that tokens encrypted under previous dev/fallback secrets decrypt seamlessly."""
    from app.core.crypto import encrypt_token, decrypt_token, LEGACY_DEV_KEY, LEGACY_FALLBACK_KEY

    # Encrypted with dev default
    tok_dev = encrypt_token("1//rt_legacy_dev", override_key=LEGACY_DEV_KEY)
    assert tok_dev is not None
    # Encrypted with legacy fallback
    tok_fallback = encrypt_token("1//rt_legacy_fallback", override_key=LEGACY_FALLBACK_KEY)
    assert tok_fallback is not None
    # Encrypted with custom primary key
    tok_primary = encrypt_token("1//rt_primary_prod", override_key="new-prod-super-secret-key-123")
    assert tok_primary is not None

    # Even with a different override key as primary, legacy tokens decrypt via candidates
    assert decrypt_token(tok_dev, override_key="different-primary-secret") == "1//rt_legacy_dev"
    assert decrypt_token(tok_fallback, override_key="different-primary-secret") == "1//rt_legacy_fallback"
    assert decrypt_token(tok_primary, override_key="new-prod-super-secret-key-123") == "1//rt_primary_prod"


@pytest.mark.anyio
async def test_refresh_token_rejects_access_token():
    """Access tokens (ya29.) stored as refresh tokens must be rejected without calling Google."""
    from app.routers.classroom import _refresh_google_token_detailed
    from app.core.crypto import encrypt_token

    enc_access_token = encrypt_token("ya29.sample_acc_token_123")
    assert enc_access_token is not None

    tok, err, status = await _refresh_google_token_detailed(enc_access_token)
    assert tok is None
    assert err == "token_is_access_token_not_refresh_token"
    assert status == 400


@pytest.mark.anyio
async def test_background_sync_skips_broken_account_and_syncs_healthy_one(classroom_db):
    """
    Ensure queue starvation is prevented: if the oldest account in active_creds
    fails to refresh, the worker does NOT abort; it continues to the next ready
    healthy account and successfully syncs the group.
    """
    from app.models import ClassroomCredential
    from app.routers import classroom as classroom_router
    from unittest.mock import patch
    from sqlalchemy import select

    client, state = classroom_db
    group_id = state["group_id"]

    # Two credentials: cred1 is older (last_synced earlier) but broken,
    # cred2 is healthy.
    async with state["sessions"]() as db:
        c1 = ClassroomCredential(
            group_id=group_id,
            google_user_id="user_broken",
            student_name="Студент Зламаний",
            refresh_token="corrupt_cipher_that_fails_decryption",
            last_synced_at=datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc),
            is_active=True,
        )
        c2 = ClassroomCredential(
            group_id=group_id,
            google_user_id="user_healthy",
            student_name="Студент Здоровий",
            refresh_token="1//healthy_rt",
            last_synced_at=datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc),
            is_active=True,
        )
        db.add_all([c1, c2])
        await db.commit()

    def fake_courses_handler(request: httpx.Request):
        url = str(request.url)
        if "/v1/courses" in url and "pageSize" in url:
            return httpx.Response(200, json={"courses": []})
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(fake_courses_handler)
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    async def fake_refresh(rt: str):
        if rt == "1//healthy_rt":
            return "ya29.healthy_fresh_token", None, 200
        return None, "missing_or_corrupt_refresh_token", 400

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client), \
         patch("app.services.classroom.tokens._refresh_google_token_detailed", side_effect=fake_refresh), \
         patch("app.services.classroom.worker._get_classroom_min_sync_gap_seconds", return_value=510.0):

        async with state["sessions"]() as db:
            await classroom_router.trigger_background_sync_if_needed(db, group_id, force=True)

        async with state["sessions"]() as db:
            db_c1 = await db.scalar(select(ClassroomCredential).where(ClassroomCredential.google_user_id == "user_broken"))
            db_c2 = await db.scalar(select(ClassroomCredential).where(ClassroomCredential.google_user_id == "user_healthy"))

            assert db_c1 is not None
            assert db_c1.fail_count == 1
            assert db_c1.last_error == "missing_or_corrupt_refresh_token"

            assert db_c2 is not None
            assert db_c2.fail_count == 0
            assert db_c2.last_error is None
            # Verified that healthy account was actually processed and synced!
            assert db_c2.last_synced_at is not None
            assert db_c2.last_synced_at.year == 2026
            c2_ts = db_c2.last_synced_at if db_c2.last_synced_at.tzinfo else db_c2.last_synced_at.replace(tzinfo=timezone.utc)
            assert c2_ts > datetime(2026, 11, 2, tzinfo=timezone.utc)


@pytest.mark.anyio
async def test_classroom_sync_interval_and_gap_allows_10_min_cycles(classroom_db):
    """
    Ensure that when 10 minutes have passed since last_synced_at, background sync with
    force=False executes without being skipped, while recent syncs (< min_gap) are throttled.
    """
    from datetime import timedelta
    from app.models import ClassroomCredential
    from app.routers import classroom as classroom_router
    from unittest.mock import patch
    from sqlalchemy import select

    client, state = classroom_db
    group_id = state["group_id"]

    assert classroom_router._get_classroom_sync_interval_seconds() == 600
    assert classroom_router._get_classroom_min_sync_gap_seconds() == 510.0

    # 1. Credential synced 11 minutes ago (> min_gap)
    eleven_mins_ago = datetime.now(timezone.utc) - timedelta(minutes=11)
    async with state["sessions"]() as db:
        c = ClassroomCredential(
            group_id=group_id,
            google_user_id="user_10min_test",
            student_name="Студент 10хв",
            refresh_token="1//valid_rt_10min",
            last_synced_at=eleven_mins_ago,
            is_active=True,
        )
        db.add(c)
        await db.commit()

    def fake_courses_handler(request: httpx.Request):
        url = str(request.url)
        if "/v1/courses" in url and "pageSize" in url:
            return httpx.Response(200, json={"courses": []})
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(fake_courses_handler)
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    async def fake_refresh(rt: str):
        return "ya29.token_for_10min", None, 200

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client), \
         patch("app.services.classroom.tokens._refresh_google_token_detailed", side_effect=fake_refresh), \
         patch("app.services.classroom.worker._get_classroom_min_sync_gap_seconds", return_value=510.0):

        # Trigger background sync with force=False (simulating the cron loop on subsequent cycles)
        async with state["sessions"]() as db:
            await classroom_router.trigger_background_sync_if_needed(db, group_id, force=False)

        # Check that it did NOT skip: last_synced_at was updated to now!
        async with state["sessions"]() as db:
            db_c = await db.scalar(select(ClassroomCredential).where(ClassroomCredential.google_user_id == "user_10min_test"))
            assert db_c is not None
            c_ts = db_c.last_synced_at if db_c.last_synced_at.tzinfo else db_c.last_synced_at.replace(tzinfo=timezone.utc)
            assert c_ts > eleven_mins_ago

        # Now try to sync AGAIN immediately (0 minutes passed < min_gap)
        with patch("app.services.classroom.sync.perform_course_sync") as mock_perform:
            async with state["sessions"]() as db:
                await classroom_router.trigger_background_sync_if_needed(db, group_id, force=False)
            # Should be skipped due to min_gap throttling!
            mock_perform.assert_not_called()


@pytest.mark.anyio
async def test_adaptive_classroom_sync_timings():
    """Перевіряє коректність адаптивних інтервалів синхронізації під розклад занять (09:00 - 15:30)."""
    from zoneinfo import ZoneInfo
    from app.routers.classroom import (
        KYIV_TZ,
        get_adaptive_classroom_sync_interval_seconds,
        _get_classroom_sync_interval_seconds,
        _get_classroom_min_sync_gap_seconds,
    )

    # 1. Розпал пар та підготовка (будні 08:30 - 16:00) -> 600 секунд (10 хвилин)
    wed_prep = datetime(2026, 11, 4, 8, 30, tzinfo=KYIV_TZ)
    assert get_adaptive_classroom_sync_interval_seconds(wed_prep) == 600
    assert _get_classroom_sync_interval_seconds(wed_prep) == 600
    assert _get_classroom_min_sync_gap_seconds(wed_prep) == 510.0

    wed_midday = datetime(2026, 11, 4, 12, 0, tzinfo=KYIV_TZ)
    assert get_adaptive_classroom_sync_interval_seconds(wed_midday) == 600

    fri_last_pair = datetime(2026, 11, 6, 15, 20, tzinfo=KYIV_TZ)
    assert get_adaptive_classroom_sync_interval_seconds(fri_last_pair) == 600

    # 2. Після занять (будні 16:00 - 21:30) -> 2100 секунд (35 хвилин)
    tue_evening = datetime(2026, 11, 3, 17, 30, tzinfo=KYIV_TZ)
    assert get_adaptive_classroom_sync_interval_seconds(tue_evening) == 2100
    assert _get_classroom_min_sync_gap_seconds(tue_evening) == 2010.0

    # 3. Пізній вечір (будні 21:30 - 23:30) -> 3600 секунд (60 хвилин)
    thu_late = datetime(2026, 11, 5, 22, 0, tzinfo=KYIV_TZ)
    assert get_adaptive_classroom_sync_interval_seconds(thu_late) == 3600

    # 4. Нічний сон (будні 23:30 - 08:30) -> сон до 08:30
    wed_night = datetime(2026, 11, 4, 23, 45, tzinfo=KYIV_TZ)
    assert get_adaptive_classroom_sync_interval_seconds(wed_night) == 14400  # clamp 4 години

    thu_early = datetime(2026, 11, 5, 5, 0, tzinfo=KYIV_TZ)
    # З 05:00 до 08:30 рівно 3.5 години (12600 секунд)
    assert get_adaptive_classroom_sync_interval_seconds(thu_early) == 12600

    thu_morning_30m = datetime(2026, 11, 5, 8, 0, tzinfo=KYIV_TZ)
    # З 08:00 до 08:30 рівно 30 хвилин (1800 секунд)
    assert get_adaptive_classroom_sync_interval_seconds(thu_morning_30m) == 1800

    # 5. Вихідні дні (Сб-Нд)
    sat_day = datetime(2026, 11, 7, 14, 0, tzinfo=KYIV_TZ)
    assert get_adaptive_classroom_sync_interval_seconds(sat_day) == 5400  # 90 хвилин

    sun_night = datetime(2026, 11, 8, 23, 0, tzinfo=KYIV_TZ)
    # У неділю о 23:00 сон до ранку понеділка 08:30 (clamp 4 год = 14400 с)
    assert get_adaptive_classroom_sync_interval_seconds(sun_night) == 14400


@pytest.mark.anyio
async def test_students_sync_throttling_and_caching(classroom_db):
    """Перевіряє, що список студентів оновлюється раз на добу, а викладачі та теми кешуються на 12 годин."""
    from app.models import Group, GroupStudent
    from app.routers import classroom as classroom_router
    from unittest.mock import patch, MagicMock

    client, state = classroom_db
    group_id = state["group_id"]

    # Очищуємо кеші перед тестом
    classroom_router._last_students_synced_at.clear()
    classroom_router._course_teachers_cache.clear()
    classroom_router._course_topics_cache.clear()

    course_obj = {
        "id": "course_cache_test_101",
        "name": "Група 85 Тестова Дисципліна",
        "section": "1 підгрупа",
    }

    students_api_calls = 0
    teachers_api_calls = 0
    topics_api_calls = 0

    def mock_transport_handler(request: httpx.Request):
        nonlocal students_api_calls, teachers_api_calls, topics_api_calls
        url = str(request.url)
        if "/students" in url:
            students_api_calls += 1
            return httpx.Response(200, json={
                "students": [
                    {"userId": "user_s1", "profile": {"name": {"fullName": "Студент Тестовий 1"}}}
                ]
            })
        if "/teachers" in url:
            teachers_api_calls += 1
            return httpx.Response(200, json={
                "teachers": [
                    {"userId": "teacher_t1", "profile": {"name": {"fullName": "Викладач 1"}}}
                ]
            })
        if "/topics" in url:
            topics_api_calls += 1
            return httpx.Response(200, json={
                "topic": [{"topicId": "top_1", "name": "Тема 1"}]
            })
        if "/announcements" in url:
            return httpx.Response(200, json={"announcements": []})
        if "/courseWorkMaterials" in url:
            return httpx.Response(200, json={"courseWorkMaterial": []})
        if "/studentSubmissions" in url:
            return httpx.Response(200, json={"studentSubmissions": []})
        if "/courseWork" in url:
            return httpx.Response(200, json={"courseWork": []})
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(mock_transport_handler)
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        async with state["sessions"]() as db:
            grp = await db.get(Group, group_id)
            # 1-й виклик: кеші порожні -> робимо запити до students, teachers, topics
            res1 = await classroom_router.perform_course_sync(
                db, grp, [course_obj], "dummy_tok", force=False
            )
            assert students_api_calls == 1
            assert teachers_api_calls == 1
            assert topics_api_calls == 1

            # 2-й виклик одразу: force=False -> students, teachers, topics НЕ повинні викликатися!
            res2 = await classroom_router.perform_course_sync(
                db, grp, [course_obj], "dummy_tok", force=False
            )
            assert students_api_calls == 1  # не збільшилося!
            assert teachers_api_calls == 1  # використано кеш!
            assert topics_api_calls == 1    # використано кеш!

            # 3-й виклик з force=True -> обхід кешів
            res3 = await classroom_router.perform_course_sync(
                db, grp, [course_obj], "dummy_tok", force=True
            )
            assert students_api_calls == 2  # оновлено примусово!
            assert teachers_api_calls == 2  # оновлено примусово!
            assert topics_api_calls == 2    # оновлено примусово!


@pytest.mark.anyio
async def test_user_submissions_endpoint(classroom_db):
    """Перевіряє роботу легкого ендпоінту /api/classroom/user-submissions для автосинхронізації здач."""
    from app.models import ClassroomCredential
    from unittest.mock import patch

    client, state = classroom_db
    group_id = state["group_id"]

    # 1. Запит без токенів і без акаунта в БД -> connected: False
    resp = await client.get("/api/classroom/user-submissions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["connected"] is False
    assert data["submissions"] == {}

    # 2. Додаємо акаунт студента з refresh_token в БД
    async with state["sessions"]() as db:
        c = ClassroomCredential(
            group_id=group_id,
            google_user_id="user_sub_test_123",
            email="student123@kre.dp.ua",
            student_name="Тестовий Студент",
            refresh_token="1//refresh_token_test_123",
            is_active=True,
        )
        db.add(c)
        await db.commit()

    def fake_classroom_api(request: httpx.Request):
        url = str(request.url)
        if "/v1/courses" in url and "pageSize" in url and "courseWork" not in url:
            return httpx.Response(200, json={
                "courses": [{
                    "id": "c_math_1",
                    "name": "Вища математика",
                    "section": "Група 85",
                }]
            })
        if "/courseWork" in url and "studentSubmissions" not in url:
            return httpx.Response(200, json={
                "courseWork": [{
                    "id": "cw_math_101",
                    "title": "Практична робота №1",
                    "alternateLink": "https://classroom.google.com/c/c_math_1/a/cw_math_101/details",
                    "maxPoints": 12,
                }]
            })
        if "studentSubmissions" in url:
            return httpx.Response(200, json={
                "studentSubmissions": [{
                    "courseWorkId": "cw_math_101",
                    "state": "TURNED_IN",
                    "assignedGrade": 11,
                }]
            })
        return httpx.Response(404, json={})

    transport = httpx.MockTransport(fake_classroom_api)
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    async def fake_refresh(rt: str):
        return "ya29.refreshed_access_token_123", None, 200

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client), \
         patch("app.services.classroom.tokens._refresh_google_token_detailed", side_effect=fake_refresh):

        # Запит через POST з X-Classroom-User-Id заголовком (як надсилає фронтенд)
        res_post = await client.post(
            "/api/classroom/user-submissions",
            headers={"X-Classroom-User-Id": "user_sub_test_123"},
            json={"group_id": group_id},
        )
        assert res_post.status_code == 200
        p_data = res_post.json()
        assert p_data["connected"] is True
        assert p_data["access_token"] == "ya29.refreshed_access_token_123"
        assert len(p_data["tasks"]) == 1
        assert p_data["tasks"][0]["state"] == "TURNED_IN"
        assert p_data["tasks"][0]["grade"] == 11
        assert p_data["tasks"][0]["max_points"] == 12

        # Перевіряємо ключ у submissions map
        assert "https://classroom.google.com/c/c_math_1/a/cw_math_101/details" in p_data["submissions"]
        sub_entry = p_data["submissions"]["https://classroom.google.com/c/c_math_1/a/cw_math_101/details"]
        assert sub_entry["state"] == "TURNED_IN"
        assert sub_entry["grade"] == 11
        assert sub_entry["maxPoints"] == 12

        # Також за ключем c_math_1_cw_math_101
        assert "c_math_1_cw_math_101" in p_data["submissions"]
        assert p_data["submissions"]["c_math_1_cw_math_101"]["state"] == "TURNED_IN"


@pytest.mark.anyio
async def test_sync_without_refresh_token_does_not_create_empty_credential_or_overwrite_valid_one(classroom_db):
    """
    1.2 & 1.5:
    - Коли на POST /api/classroom/sync приходить лише access_token (без refresh_token) або ya29 у полі refresh_token,
      бекенд не створює запис ClassroomCredential з порожнім refresh_token = "".
    - Якщо у студента вже є робочий ClassroomCredential із валідним refresh_token, повторний синк лише з access_token
      НЕ затирає існуючий refresh_token.
    - У відповіді /api/classroom/sync ніколи не повертається сирий refresh_token для збереження в localStorage.
    """
    client, state = classroom_db
    group_id = state["group_id"]
    monday: date = state["monday"]

    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.only_access_1": [{"id": "101", "name": "Іноземна мова 85 ДФКР (1 підгр)"}],
            "ya29.with_rt_2": [{"id": "101", "name": "Іноземна мова 85 ДФКР (1 підгр)"}],
        },
        profiles_by_token={
            "ya29.only_access_1": {"id": "uid_no_rt", "emailAddress": "nort@kre.dp.ua"},
            "ya29.with_rt_2": {"id": "uid_has_rt", "emailAddress": "hasrt@kre.dp.ua"},
        },
        teachers_by_course={
            "101": [{"userId": "t1", "profile": {"name": {"fullName": "Токарєва Тетяна Олександрівна"}}}],
        },
        announcements_by_course={"101": []},
        coursework_by_course={"101": []},
    )
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        # 1) Синк лише з access_token (або коли в refresh_token випадково передали ya29...)
        r_no_rt = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.only_access_1",
                "refresh_token": "ya29.accidental_access_token",
                "group_id": group_id,
                "week_start": monday.isoformat(),
            },
        )
        assert r_no_rt.status_code == 200
        assert r_no_rt.json()["refresh_token"] is None

        async with state["sessions"]() as db:
            cred_no_rt = await db.scalar(
                select(ClassroomCredential).where(ClassroomCredential.google_user_id == "uid_no_rt")
            )
            assert cred_no_rt is None

        # 2) Синк із валідним refresh_token створює запис, а наступний синк без refresh_token не затирає його
        r_with_rt = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.with_rt_2",
                "refresh_token": "1//valid_refresh_token_student",
                "group_id": group_id,
                "week_start": monday.isoformat(),
            },
        )
        assert r_with_rt.status_code == 200
        assert r_with_rt.json()["refresh_token"] is None

        r_again_without_rt = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.with_rt_2",
                "group_id": group_id,
                "week_start": monday.isoformat(),
            },
        )
        assert r_again_without_rt.status_code == 200

        async with state["sessions"]() as db:
            cred_has_rt = await db.scalar(
                select(ClassroomCredential).where(ClassroomCredential.google_user_id == "uid_has_rt")
            )
            assert cred_has_rt is not None
            assert cred_has_rt.is_active is True
            assert decrypt_token(cred_has_rt.refresh_token) == "1//valid_refresh_token_student"


@pytest.mark.anyio
async def test_long_tokens_are_not_truncated_and_userinfo_fallback_works(classroom_db):
    """
    1.3 & 1.4:
    - Довгі токени (> 512 символів після шифрування Fernet) зберігаються в ClassroomGroupBinding та ClassroomCredential
      без обрізання [:512] і успішно розшифровуються.
    - Якщо userProfiles/me не повертає emailAddress, бекенд робить фолбек на oauth2/v3/userinfo і дістає реальний email та sub.
    """
    client, state = classroom_db
    group_id = state["group_id"]
    monday: date = state["monday"]

    long_access_token = "ya29." + ("A" * 600)
    long_refresh_token = "1//" + ("R" * 600)

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/v1/courses" in url and "/teachers" not in url and "/announcements" not in url and "/courseWork" not in url and "/topics" not in url and "/students" not in url:
            return httpx.Response(200, json={"courses": [{"id": "101", "name": "Іноземна мова 85 ДФКР"}]})
        if url.endswith("/v1/userProfiles/me"):
            # Імітуємо випадок, коли Classroom API не повернув emailAddress (відсутній або порожній)
            return httpx.Response(200, json={"id": "uid_from_me_777", "name": {"fullName": "Студент Тест"}})
        if "oauth2/v3/userinfo" in url:
            return httpx.Response(200, json={
                "sub": "uid_from_me_777",
                "email": "real.student@kre.dp.ua",
                "name": "Студент Тест",
                "picture": "https://example.com/avatar.png",
            })
        return httpx.Response(200, json={})

    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        resp = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": long_access_token,
                "refresh_token": long_refresh_token,
                "group_id": group_id,
                "week_start": monday.isoformat(),
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_email"] == "real.student@kre.dp.ua"
        assert data["google_user_id"] == "uid_from_me_777"

    async with state["sessions"]() as db:
        binding = await db.scalar(
            select(ClassroomGroupBinding).where(ClassroomGroupBinding.group_id == group_id)
        )
        assert binding is not None
        assert len(binding.access_token) > 512
        assert len(binding.refresh_token) > 512
        assert decrypt_token(binding.access_token) == long_access_token
        assert decrypt_token(binding.refresh_token) == long_refresh_token


@pytest.mark.anyio
async def test_group_detection_prioritizes_explicit_payload_group_id_and_reconstructs_max_points(classroom_db):
    """
    2.1 & 2.2:
    - Якщо студент обрав свою групу (payload.group_id = 85 ДФКР), але в його акаунті є більше старих курсів іншої групи (напр. 75),
      система НЕ перемикає його примусово на іншу групу.
    - Після очищення _latest_group_tasks (імітація рестарту сервера) /groups/{id}/status відновлює завдання разом із max_points.
    """
    client, state = classroom_db
    group_85_id = state["group_id"]
    monday: date = state["monday"]
    monday_iso = f"{monday.isoformat()}T08:00:00Z"

    async with state["sessions"]() as db:
        other_group = Group(name="75", is_active=True)
        db.add(other_group)
        await db.commit()
        group_75_id = other_group.id

    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.multi_group_student": [
                {"id": "c75_1", "name": "Архівний курс 1 — група 75"},
                {"id": "c75_2", "name": "Архівний курс 2 — група 75"},
                {"id": "c85_1", "name": "Іноземна мова 85 ДФКР"},
            ],
        },
        profiles_by_token={
            "ya29.multi_group_student": {"id": "uid_multi_85", "emailAddress": "multi85@kre.dp.ua"},
        },
        teachers_by_course={
            "c85_1": [{"userId": "t1", "profile": {"name": {"fullName": "Токарєва Тетяна Олександрівна"}}}],
        },
        announcements_by_course={},
        coursework_by_course={
            "c85_1": [{
                "id": "cw_pts_12",
                "title": "Контрольна робота з англійської",
                "alternateLink": "https://classroom.google.com/c/c85_1/a/cw_pts_12/details",
                "creationTime": monday_iso,
                "dueDate": {"year": monday.year, "month": monday.month, "day": monday.day},
                "maxPoints": 12,
                "creatorUserId": "t1",
            }],
        },
    )
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        resp = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.multi_group_student",
                "refresh_token": "1//rt_multi_85",
                "group_id": group_85_id,
                "week_start": monday.isoformat(),
            },
        )
        assert resp.status_code == 200
        res_data = resp.json()
        # Незважаючи на 2 курси групи 75 проти 1 курсу групи 85, залишається обрана студентом група 85!
        assert res_data["group_id"] == group_85_id
        assert res_data["group_id"] != group_75_id

        # Імітуємо перезапуск сервера: очищуємо оперативний кеш _latest_group_tasks
        classroom_router._latest_group_tasks.clear()

        with patch("app.services.classroom.worker.run_background_sync_task") as mock_bg_sync:
            # Гість без авторизації не отримує завдання групи
            guest_resp = await client.get(f"/api/classroom/groups/{group_85_id}/status")
            assert guest_resp.status_code == 200
            guest_data = guest_resp.json()
            assert guest_data["requires_auth"] is True
            assert guest_data["tasks"] == []

            # Авторизований студент групи відновлює завдання разом із max_points
            st_resp = await client.get(
                f"/api/classroom/groups/{group_85_id}/status",
                headers={"X-Classroom-User-Id": "uid_multi_85"},
            )
            assert st_resp.status_code == 200
            st_data = st_resp.json()
            assert st_data["requires_auth"] is False
            assert len(st_data["tasks"]) == 1
            reconstructed_task = st_data["tasks"][0]
            assert reconstructed_task["title"] == "Контрольна робота з англійської"
            assert reconstructed_task["max_points"] == 12
            mock_bg_sync.assert_called_once_with(group_85_id, force=True)


@pytest.mark.anyio
async def test_classroom_sync_handles_long_photo_url_and_profile_fields(classroom_db):
    """25.4.1: Перевірка захисту від StringDataRightTruncation при довгих photoUrl, імені та пошті."""
    client, state = classroom_db
    group_id = state["group_id"]
    long_photo = "//lh3.googleusercontent.com/a-/" + ("A" * 600)
    long_name = "Студент " + ("ДужеДовгеІм'я" * 20)
    long_email = ("student_email_" * 15) + "@kre.dp.ua"

    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.long_profile_token": [
                {"id": "c85_1", "name": "85 ДФКР Іноземна мова"}
            ],
        },
        profiles_by_token={
            "ya29.long_profile_token": {
                "id": "101037898429499839148",
                "emailAddress": long_email,
                "name": {"fullName": long_name},
                "photoUrl": long_photo,
            },
        },
        teachers_by_course={
            "c85_1": [{"userId": "t1", "profile": {"name": {"fullName": "Токарєва Т.О."}}}],
        },
        announcements_by_course={},
        coursework_by_course={},
    )
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        resp = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.long_profile_token",
                "refresh_token": "1//rt_long_profile_test",
                "group_id": group_id,
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["group_id"] == group_id

        # Перевіряємо статус групи та збережені акаунти
        st_resp = await client.get(f"/api/classroom/groups/{group_id}/status")
        assert st_resp.status_code == 200
        st_data = st_resp.json()
        assert st_data["connected_accounts_count"] == 1
        acc = st_data["accounts"][0]
        assert acc["google_user_id"] == "101037898429499839148"
        assert len(acc["email"]) <= 150
        assert len(acc["student_name"]) <= 150
        assert acc["photo_url"].startswith("https://")


@pytest.mark.anyio
async def test_dynamic_subgroup_detection_for_arbitrary_teachers(classroom_db):
    """
    Перевірка динамічного визначення підгруп 1 та 2 для будь-яких викладачів (без хардкоду):
    - Створюємо групу та пару з викладачами Ковальов (1 підгр) та Шевченко (2 підгр)
    - Студент 1 синхронізує курс Ковальова -> визначається subgroup=1
    - Студент 2 синхронізує курс Шевченка -> визначається subgroup=2
    """
    client, state = classroom_db
    monday: date = state["monday"]

    async with state["sessions"]() as db:
        group = Group(name="99-ТЕСТ", is_active=True)
        t_kovalyov = Teacher(name="Ковальов В.І.", full_name="Ковальов Віктор Іванович", is_active=True)
        t_shevchenko = Teacher(name="Шевченко М.П.", full_name="Шевченко Михайло Петрович", is_active=True)
        subj = Subject(name="Комп'ютерна графіка", is_active=True)
        db.add_all([group, t_kovalyov, t_shevchenko, subj])
        await db.flush()

        lesson = Schedule(
            group_id=group.id,
            subject_id=subj.id,
            teacher_id=t_kovalyov.id,
            second_teacher_id=t_shevchenko.id,
            day_of_week=1,
            lesson_number=3,
            week_type="both",
            is_active=True,
        )
        db.add(lesson)
        await db.commit()
        g_id = group.id

    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.student_kovalyov": [
                {"id": "c_kov", "name": "Комп'ютерна графіка 99-ТЕСТ"},
            ],
            "ya29.student_shevchenko": [
                {"id": "c_shev", "name": "Комп'ютерна графіка 99-ТЕСТ"},
            ],
        },
        profiles_by_token={
            "ya29.student_kovalyov": {"id": "uid_stud_kov", "emailAddress": "kov_student@kre.dp.ua", "name": {"fullName": "Студент Першої Підгрупи"}},
            "ya29.student_shevchenko": {"id": "uid_stud_shev", "emailAddress": "shev_student@kre.dp.ua", "name": {"fullName": "Студент Другої Підгрупи"}},
        },
        teachers_by_course={
            "c_kov": [{"userId": "t_kov_uid", "profile": {"name": {"fullName": "Ковальов Віктор Іванович"}}}],
            "c_shev": [{"userId": "t_shev_uid", "profile": {"name": {"fullName": "Шевченко Михайло Петрович"}}}],
        },
        announcements_by_course={},
        coursework_by_course={},
    )
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client):
        # 1. Синхронізуємо студента першої підгрупи
        resp1 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.student_kovalyov",
                "refresh_token": "1//rt_kov",
                "group_id": g_id,
                "week_start": monday.isoformat(),
            },
        )
        assert resp1.status_code == 200

        # 2. Синхронізуємо студента другої підгрупи
        resp2 = await client.post(
            "/api/classroom/sync",
            json={
                "access_token": "ya29.student_shevchenko",
                "refresh_token": "1//rt_shev",
                "group_id": g_id,
                "week_start": monday.isoformat(),
            },
        )
        assert resp2.status_code == 200

        # Перевіряємо збережені акаунти у статусі
        st_resp = await client.get(f"/api/classroom/groups/{g_id}/status")
        assert st_resp.status_code == 200
        st_data = st_resp.json()
        assert st_data["connected_accounts_count"] == 2

        acc_kov = next(a for a in st_data["accounts"] if a["google_user_id"] == "uid_stud_kov")
        acc_shev = next(a for a in st_data["accounts"] if a["google_user_id"] == "uid_stud_shev")

        # Перевіряємо, що підгрупи визначено динамічно і правильно
        assert acc_kov["subgroup"] == 1
        assert acc_shev["subgroup"] == 2


@pytest.mark.anyio
async def test_transient_courses_429_does_not_deactivate_or_overwrite_refresh_token(classroom_db):
    from datetime import timedelta
    from sqlalchemy import select
    from app.models import ClassroomCredential

    client, state = classroom_db
    gid = state["group_id"]
    monday = state["monday"]
    now_utc = datetime.now(timezone.utc)

    enc_rt = encrypt_token("1//valid_rt_429_test")
    async with state["sessions"]() as db:
        cred = ClassroomCredential(
            group_id=gid,
            google_user_id="uid_429_user",
            email="ratelimit@kre.dp.ua",
            student_name="Тест Ліміт",
            refresh_token=enc_rt,
            last_synced_at=now_utc - timedelta(hours=2),
            is_active=True,
            needs_relink=False,
        )
        db.add(cred)
        await db.commit()

    # 1. Google Classroom /v1/courses повертає 429 під час /user-submissions -> НЕ повинно ставити is_active=False або needs_relink=True
    transport_429 = _make_fake_google_transport(
        courses_by_token={},
        profiles_by_token={},
        teachers_by_course={},
        announcements_by_course={},
        coursework_by_course={},
        courses_status_by_token={"ya29.fresh_ok": 429},
    )
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport_429
        return real_async_client(*args, **kwargs)

    async def fake_refresh_ok(rt: str):
        return "ya29.fresh_ok", None, 200

    with (
        patch("app.services.classroom.tokens._refresh_google_token_detailed", side_effect=fake_refresh_ok),
        patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client),
    ):
        res_sub = await client.post(
            "/api/classroom/user-submissions",
            json={
                "group_id": gid,
                "google_user_id": "uid_429_user",
                "email": "ratelimit@kre.dp.ua",
            },
        )
        assert res_sub.status_code == 200
        body_sub = res_sub.json()
        assert body_sub["connected"] is False
        assert body_sub["needs_relink"] is False
        assert body_sub["reason_code"] == "temporary_error"

        # 2. Тихий /api/classroom/sync без access_token на 429:
        #    НЕ псує refresh_token цифрою 200 і НЕ ставить is_active=False / needs_relink=True
        res_sync = await client.post(
            "/api/classroom/sync",
            json={
                "group_id": gid,
                "google_user_id": "uid_429_user",
                "email": "ratelimit@kre.dp.ua",
                "week_start": monday.isoformat(),
            },
        )
        assert res_sync.status_code == 200
        body_sync = res_sync.json()
        assert body_sync["needs_relink"] is False
        assert body_sync["reason_code"] == "temporary_error"

    async with state["sessions"]() as db:
        saved = await db.scalar(
            select(ClassroomCredential).where(ClassroomCredential.google_user_id == "uid_429_user")
        )
        assert saved is not None
        assert saved.is_active is True
        assert saved.needs_relink is False
        assert saved.fail_count >= 2
        assert saved.next_attempt_at is not None
        assert decrypt_token(saved.refresh_token) == "1//valid_rt_429_test"


@pytest.mark.anyio
async def test_auto_recovery_and_five_account_rotation_without_cap(classroom_db):
    from datetime import timedelta
    from sqlalchemy import select
    from app.models import ClassroomCredential

    _, state = classroom_db
    gid = state["group_id"]
    now_utc = datetime.now(timezone.utc)

    # Група має поділ на підгрупи (has_split > 0) і 5 акаунтів:
    # 1-й синхронізувався 2 год тому (підгрупа 1), а інші 4 — 18 год тому,
    # включно з одним помилково деактивованим через courses_error_429.
    creds = [
        ClassroomCredential(
            group_id=gid,
            google_user_id="uid_rot_1",
            email="rot1@kre.dp.ua",
            subgroup=1,
            refresh_token=encrypt_token("1//rot_1"),
            last_synced_at=now_utc - timedelta(hours=2),
            is_active=True,
            needs_relink=False,
        ),
        ClassroomCredential(
            group_id=gid,
            google_user_id="uid_rot_2",
            email="rot2@kre.dp.ua",
            subgroup=2,
            refresh_token=encrypt_token("1//rot_2"),
            last_synced_at=now_utc - timedelta(hours=18),
            is_active=False,
            needs_relink=True,
            last_error="needs_relink: courses_error_429",
            fail_count=1,
        ),
        ClassroomCredential(
            group_id=gid,
            google_user_id="uid_rot_3",
            email="rot3@kre.dp.ua",
            subgroup=None,
            refresh_token=encrypt_token("1//rot_3"),
            last_synced_at=now_utc - timedelta(hours=18),
            is_active=True,
            needs_relink=False,
        ),
        ClassroomCredential(
            group_id=gid,
            google_user_id="uid_rot_4",
            email="rot4@kre.dp.ua",
            subgroup=None,
            refresh_token=encrypt_token("1//rot_4"),
            last_synced_at=now_utc - timedelta(hours=18),
            is_active=True,
            needs_relink=False,
        ),
        ClassroomCredential(
            group_id=gid,
            google_user_id="uid_rot_5",
            email="rot5@kre.dp.ua",
            subgroup=None,
            refresh_token=encrypt_token("1//rot_5"),
            last_synced_at=now_utc - timedelta(hours=18),
            is_active=True,
            needs_relink=False,
        ),
    ]
    async with state["sessions"]() as db:
        db.add_all(creds)
        await db.commit()

    transport = _make_fake_google_transport(
        courses_by_token={
            "ya29.rot_tok": [{"id": "c_phil", "name": "Основи філософських знань"}],
        },
        profiles_by_token={},
        teachers_by_course={
            "c_phil": [{"userId": "t_sh", "profile": {"name": {"fullName": "Домніна Галина Сергіївна"}}}],
        },
        announcements_by_course={},
        coursework_by_course={},
    )
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    async def fake_refresh(rt: str):
        return "ya29.rot_tok", None, 200

    with (
        patch("app.services.classroom.tokens._refresh_google_token_detailed", side_effect=fake_refresh),
        patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client),
        patch("app.services.classroom.tokens.get_google_client_secret", return_value="secret_ok"),
    ):
        async with state["sessions"]() as db:
            await classroom_router.trigger_background_sync_if_needed(db, gid, force=False)

    async with state["sessions"]() as db:
        updated = (
            await db.scalars(
                select(ClassroomCredential).where(ClassroomCredential.group_id == gid)
            )
        ).all()
        assert len(updated) == 5
        for c in updated:
            assert c.is_active is True
            assert c.needs_relink is False
            assert c.last_error is None
            ts = c.last_synced_at if c.last_synced_at.tzinfo else c.last_synced_at.replace(tzinfo=timezone.utc)
            assert (datetime.now(timezone.utc) - ts).total_seconds() < 120


@pytest.mark.anyio
async def test_admin_sync_group_now_endpoint(classroom_db):
    from datetime import timedelta
    from app.core.security import create_access_token, hash_password
    from app.models import ClassroomCredential, User

    client, state = classroom_db
    gid = state["group_id"]
    now_utc = datetime.now(timezone.utc)

    async with state["sessions"]() as db:
        admin = User(
            username="admin_cls_sync",
            name="Admin Sync",
            password_hash=hash_password("pass123"),
            role="admin",
            is_active=True,
        )
        viewer = User(
            username="viewer_cls_sync",
            name="Viewer Sync",
            password_hash=hash_password("pass123"),
            role="viewer",
            is_active=True,
        )
        cred = ClassroomCredential(
            group_id=gid,
            google_user_id="uid_force_1",
            email="force@kre.dp.ua",
            refresh_token=encrypt_token("1//force_rt"),
            last_synced_at=now_utc - timedelta(hours=10),
            is_active=True,
            needs_relink=False,
        )
        db.add_all([admin, viewer, cred])
        await db.commit()
        admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
        viewer_headers = {"Authorization": f"Bearer {create_access_token(viewer)}"}

    # Гість і viewer не мають доступу
    unauth = await client.post(f"/api/classroom/groups/{gid}/sync-now")
    assert unauth.status_code == 401
    forb = await client.post(f"/api/classroom/groups/{gid}/sync-now", headers=viewer_headers)
    assert forb.status_code == 403

    transport = _make_fake_google_transport(
        courses_by_token={"ya29.force_ok": [{"id": "c_phil", "name": "Основи філософських знань"}]},
        profiles_by_token={},
        teachers_by_course={},
        announcements_by_course={},
        coursework_by_course={},
    )
    real_async_client = httpx.AsyncClient

    def mocked_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    async def fake_refresh(rt: str):
        return "ya29.force_ok", None, 200

    with (
        patch("app.services.classroom.tokens._refresh_google_token_detailed", side_effect=fake_refresh),
        patch("app.routers.classroom.httpx.AsyncClient", side_effect=mocked_client),
    ):
        resp = await client.post(f"/api/classroom/groups/{gid}/sync-now", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["connected_accounts_count"] == 1
    assert "worker_heartbeat" in data


@pytest.mark.anyio
async def test_sync_all_connected_groups_once_isolates_timeout_and_persists_heartbeat(classroom_db):
    from datetime import timedelta
    from app.models import ClassroomCredential, Group
    from app.services import cache_rev

    _, state = classroom_db
    gid1 = state["group_id"]
    now_utc = datetime.now(timezone.utc)

    async with state["sessions"]() as db:
        g2 = Group(name="86 ДФКР", is_active=True)
        db.add(g2)
        await db.flush()
        gid2 = g2.id
        db.add_all([
            ClassroomCredential(
                group_id=gid1,
                google_user_id="uid_hb_1",
                email="hb1@kre.dp.ua",
                refresh_token=encrypt_token("1//hb1"),
                last_synced_at=now_utc - timedelta(hours=5),
                is_active=True,
            ),
            ClassroomCredential(
                group_id=gid2,
                google_user_id="uid_hb_2",
                email="hb2@kre.dp.ua",
                refresh_token=encrypt_token("1//hb2"),
                last_synced_at=now_utc - timedelta(hours=5),
                is_active=True,
            ),
        ])
        await db.commit()

    rev_before = cache_rev.global_rev

    async def fake_trigger(db_sess, target_gid: int, max_accounts: int = 5, force: bool = False):
        if target_gid == gid1:
            raise TimeoutError("simulated timeout")
        return None

    async def noop_sleep(_secs: float):
        return None

    with (
        patch("app.services.classroom.worker.async_session_factory", state["sessions"]),
        patch("app.services.classroom.worker.trigger_background_sync_if_needed", side_effect=fake_trigger),
        patch.object(classroom_router.asyncio, "sleep", side_effect=noop_sleep),
    ):
        result = await classroom_router.sync_all_connected_groups_once(force=False)

    assert result["checked_groups"] == 2
    assert result["processed"] == [gid2]
    assert len(result["errors"]) == 1
    assert result["errors"][0]["group_id"] == gid1
    # Запис heartbeat не повинен скидати глобальний кеш розкладу
    assert cache_rev.global_rev == rev_before

    async with state["sessions"]() as db:
        hb = await classroom_router._read_classroom_heartbeat(db)
        assert hb is not None
        assert hb["checked_groups"] == 2
        assert hb["processed"] == [gid2]
        assert len(hb["errors"]) == 1







