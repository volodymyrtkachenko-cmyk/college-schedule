from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo
import pytest

from app.routers.classroom import (
    _parse_announcement,
    _matches_lesson,
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


def test_parse_announcement_evening_weekday_maps_to_next_day():
    monday_evening = datetime(2026, 10, 19, 17, 30, tzinfo=KYIV_TZ)
    text = "Посилання на лекцію: https://meet.google.com/eve-123"

    parsed = _parse_announcement(text, monday_evening)
    assert parsed["target_date"] == date(2026, 10, 20)
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

