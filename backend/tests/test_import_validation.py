from datetime import date
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.routers.admin_import import (
    _deduplicate_import_changes,
    validate_and_sanitize_import_items,
)
from app.services.importer.differ import ScheduleDiffer
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.parsers.kre_parser import ParsedLesson, ParsedWeek


def test_validate_and_sanitize_import_items_filters_invalid_records():
    long_room = "ауд. " + ("411-А" * 30)
    substitutions = [
        # Valid substitution
        {
            "date": "2026-11-05",  # Thursday
            "lesson_number": 2,
            "group_id": 10,
            "subject_id": 20,
            "teacher_id": 30,
            "second_teacher_id": 30,  # duplicate teacher should become None
            "room": long_room,
            "week_type": "invalid_week",  # should fallback to 'both'
        },
        # Invalid lesson_number (5 > 4)
        {
            "date": "2026-11-05",
            "lesson_number": 5,
            "group_id": 10,
            "subject_id": 20,
        },
        # Invalid weekend date (Saturday)
        {
            "date": "2026-11-07",
            "lesson_number": 1,
            "group_id": 10,
            "subject_id": 20,
        },
        # Invalid boolean lesson_number
        {
            "date": "2026-11-05",
            "lesson_number": True,
            "group_id": 10,
            "subject_id": 20,
        },
        # Missing subject_id
        {
            "date": "2026-11-05",
            "lesson_number": 1,
            "group_id": 10,
            "subject_id": None,
        },
    ]

    cancelled = [
        {"date": "2026-11-05", "lesson_number": 3, "group_id": 10, "week_type": "denominator"},
        {"date": "2026-11-08", "lesson_number": 1, "group_id": 10},  # Sunday -> filtered out
        {"date": "not-a-date", "lesson_number": 1, "group_id": 10},
        {"date": "2026-11-05", "lesson_number": 0, "group_id": 10},
    ]

    base_slots = [
        {
            "date": "2026-11-05",
            "day_of_week": 99,  # recalculated from date -> 4
            "lesson_number": 1,
            "group_id": 10,
            "subject_id": 20,
            "teacher_id": 30,
            "second_teacher_id": 30,
            "room": long_room,
            "week_type": "numerator",
        },
        # Weekend base slot -> filtered out
        {
            "date": "2026-11-07",
            "day_of_week": 6,
            "lesson_number": 1,
            "group_id": 10,
            "subject_id": 20,
        },
    ]

    clean_subs, clean_canc, clean_base = validate_and_sanitize_import_items(
        substitutions, cancelled, base_slots
    )

    assert len(clean_subs) == 1
    assert clean_subs[0]["second_teacher_id"] is None
    assert clean_subs[0]["week_type"] == "both"
    assert len(clean_subs[0]["room"]) <= 100

    assert len(clean_canc) == 1
    assert clean_canc[0]["lesson_number"] == 3
    assert clean_canc[0]["week_type"] == "denominator"

    assert len(clean_base) == 1
    assert clean_base[0]["day_of_week"] == 4
    assert clean_base[0]["second_teacher_id"] is None
    assert len(clean_base[0]["room"]) <= 100


def test_deduplicate_import_changes_cancellation_overrides_substitution():
    subs = [
        {
            "date": "2026-11-05",
            "lesson_number": 2,
            "group_id": 10,
            "subject_id": 20,
            "teacher_id": 30,
            "room": "411",
        }
    ]
    canc = [
        {
            "date": "2026-11-05",
            "lesson_number": 2,
            "group_id": 10,
        }
    ]
    dedup_subs, dedup_canc = _deduplicate_import_changes(subs, canc)
    assert dedup_subs == []
    assert len(dedup_canc) == 1


@pytest.mark.anyio
async def test_schedule_differ_truncates_oversized_strings_and_ignores_invalid_slots():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    try:
        async with sessions() as db:
            normalizer = EntityNormalizer(db)
            await normalizer.load_dictionaries()
            differ = ScheduleDiffer(db, normalizer)

            week = ParsedWeek(
                groups=["85"],
                week_type="numerator",
                lessons=[
                    ParsedLesson(
                        date=date(2026, 11, 5),  # Thursday
                        group_name="ГР-" + ("8" * 150),
                        lesson_number=1,
                        subject_name="Предмет " + ("А" * 300),
                        teacher_name="Викладач " + ("Б" * 300),
                        room="Кабінет " + ("9" * 150),
                        is_substitution=True,
                    ),
                    # Weekend lesson should be ignored
                    ParsedLesson(
                        date=date(2026, 11, 7),  # Saturday
                        group_name="85",
                        lesson_number=1,
                        subject_name="Математика",
                        teacher_name="Іваненко І.І.",
                    ),
                    # Lesson number 5 should be ignored
                    ParsedLesson(
                        date=date(2026, 11, 5),
                        group_name="85",
                        lesson_number=5,
                        subject_name="Математика",
                        teacher_name="Іваненко І.І.",
                    ),
                ],
            )

            report = await differ.diff(week)
            assert len(report["substitutions"]) == 1
            sub = report["substitutions"][0]
            assert len(sub["room"]) <= 100
            assert report["base_slots"] == []
    finally:
        await engine.dispose()
