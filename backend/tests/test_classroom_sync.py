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



