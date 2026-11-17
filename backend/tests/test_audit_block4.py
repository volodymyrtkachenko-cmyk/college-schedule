import asyncio
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import (
    AcademicEvent,
    ClassroomCredential,
    Curriculum,
    Group,
    GroupStudent,
    Schedule,
    ScheduleDraft,
    SchedulePeriodSlot,
    ScheduleSlot,
    ScheduleVersion,
    Subject,
    Teacher,
)
from app.routers import admin_import, events as events_router, generator as generator_router
from app.services import solver
from app.services.importer import differ as differ_mod, fetcher as fetcher_mod, orchestrator as orchestrator_mod
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.parsers.kre_parser import ParsedLesson, ParsedWeek
from app.services.projection import infer_lesson_number


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_block4_finding11_anomaly_thresholds_and_no_5th_lesson(monkeypatch):
    """
    Finding #11:
    1. Mass cancellations exceeding anomaly_group_threshold / anomaly_total_threshold
       trigger is_anomaly=True and create a pending anomaly draft.
    2. Events and projection no longer allow or infer a 5th lesson (capped at 1..4).
    """
    # Part A: 5th lesson removed in events & projection
    assert infer_lesson_number("15:40") == 4
    with pytest.raises(ValidationError):
        events_router.EventCreatePayload(
            group_id=1,
            title="Test",
            event_date=date(2026, 10, 20),
            lesson_number=5,
        )

    # Part B: Anomaly threshold check on mass cancellations
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async with session_maker() as db:
        g = Group(name="Група 101", is_active=True)
        s = Subject(name="Математика", is_active=True)
        t = Teacher(name="Іваненко І.І.", is_active=True)
        v = ScheduleVersion(
            name="Семестр 1",
            valid_from=date(2026, 9, 1),
            valid_until=date(2026, 12, 31),
            is_active=True,
        )
        db.add_all([g, s, t, v])
        await db.commit()

        # 6 base schedule lessons for group 101
        for dow in (1, 2):
            for ln in (1, 2, 3):
                db.add(
                    Schedule(
                        group_id=g.id,
                        subject_id=s.id,
                        teacher_id=t.id,
                        day_of_week=dow,
                        lesson_number=ln,
                        week_type="both",
                        is_active=True,
                        version_id=v.id,
                    )
                )
        await db.commit()

        # Incoming import has 5 cancellations (> 30% of 6 base slots and >= 5 total)
        cancs = [
            {
                "group_id": g.id,
                "date": "2026-10-20",
                "lesson_number": ln,
                "week_type": "both",
            }
            for ln in (1, 2, 3, 4)
        ] + [
            {
                "group_id": g.id,
                "date": "2026-10-21",
                "lesson_number": 1,
                "week_type": "both",
            }
        ]

        monkeypatch.setattr(admin_import.ScheduleFetcher, "get_all_group_ids", AsyncMock(return_value=["g1"]))
        monkeypatch.setattr(admin_import.ScheduleFetcher, "fetch_html", AsyncMock(return_value="<html>ok</html>"))
        monkeypatch.setattr(
            admin_import.KREParser,
            "parse",
            Mock(
                return_value=SimpleNamespace(
                    week_type="both",
                    lessons=[SimpleNamespace(date=date(2026, 10, 20))],
                )
            ),
        )
        monkeypatch.setattr(admin_import.EntityNormalizer, "load_dictionaries", AsyncMock())
        monkeypatch.setattr(
            admin_import.ScheduleDiffer,
            "diff",
            AsyncMock(
                return_value={
                    "unresolved": [],
                    "unresolved_substitutions": [],
                    "substitutions": [],
                    "cancelled": cancs,
                    "base_slots": [],
                    "skipped_base_slots": [],
                }
            ),
        )
        monkeypatch.setattr(orchestrator_mod, "matches_published_schedule", AsyncMock(return_value=False))

        res = await admin_import._do_import(db, 2, "test-anom-11", actor_id=None)
        assert res["status"] == "anomaly_draft"
        assert res["meta"]["is_anomaly"] is True
        assert res["meta"]["auto_published"] is False
        assert len(res["meta"]["anomaly_reasons"]) >= 1

    await engine.dispose()


@pytest.mark.anyio
async def test_block4_finding21_batch_entity_creation_single_flush():
    """
    Finding #21:
    ScheduleDiffer auto-creates missing groups, subjects, and teachers in a single batch flush
    rather than N+1 flushes per lesson.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async with session_maker() as db:
        normalizer = EntityNormalizer(db)
        await normalizer.load_dictionaries()
        differ = differ_mod.ScheduleDiffer(db, normalizer)

        flush_count = 0
        orig_flush = db.flush

        async def counting_flush(*args, **kwargs):
            nonlocal flush_count
            flush_count += 1
            return await orig_flush(*args, **kwargs)

        db.flush = counting_flush

        pw = ParsedWeek(
            week_type="both",
            lessons=[
                ParsedLesson(
                    date=date(2026, 10, 20),
                    group_name=f"Гр-{i}",
                    lesson_number=(i % 4) + 1,
                    subject_name=f"Предмет {i}",
                    teacher_name=f"Викладач {i}",
                )
                for i in range(1, 6)
            ],
        )
        report = await differ.diff(pw)
        assert len(report["base_slots"]) == 5
        # Only 1 batch flush instead of 15+ flushes
        assert flush_count == 1

    await engine.dispose()


def test_block4_finding22_orm_indexes_present():
    """
    Finding #22:
    Verify newly added FK and composite indexes exist on SQLAlchemy models.
    """
    group_idx_cols = {c.name for idx in Group.__table__.indexes for c in idx.columns}
    assert "faculty_id" in group_idx_cols
    assert "curator_id" in group_idx_cols

    curr_idx_cols = {c.name for idx in Curriculum.__table__.indexes for c in idx.columns}
    assert {"subject_id", "teacher_id", "second_teacher_id"}.issubset(curr_idx_cols)

    period_slot_idx_cols = {c.name for idx in SchedulePeriodSlot.__table__.indexes for c in idx.columns}
    assert {"subject_id", "teacher_id", "second_teacher_id"}.issubset(period_slot_idx_cols)

    draft_idx_names = {idx.name for idx in ScheduleDraft.__table__.indexes}
    assert "ix_schedule_drafts_type_status" in draft_idx_names

    slot_idx_names = {idx.name for idx in ScheduleSlot.__table__.indexes}
    assert "ix_schedule_slots_draft_day_lesson" in slot_idx_names

    event_idx_names = {idx.name for idx in AcademicEvent.__table__.indexes}
    assert "ix_schedule_events_group_date" in event_idx_names

    student_idx_cols = {c.name for idx in GroupStudent.__table__.indexes for c in idx.columns}
    assert "email" in student_idx_cols

    cred_idx_names = {idx.name for idx in ClassroomCredential.__table__.indexes}
    assert "ix_classroom_cred_active_sync" in cred_idx_names


@pytest.mark.anyio
async def test_block4_finding23_solver_semaphore_and_async_main_page_parse(monkeypatch):
    """
    Finding #23:
    1. Concurrent _run_solver calls are serialized by _solver_semaphore (max active = 1).
    2. ScheduleFetcher._parse_main_page_sync extracts group IDs and sha256 off the event loop.
    """
    html = '<div class="ktt-groups"><a data-item="101">КІ-101</a><a data-item="102">КІ-102</a></div>'
    p_hash, g_ids = fetcher_mod._parse_main_page_sync(html)
    assert len(p_hash) == 64
    assert g_ids == ["101", "102"]

    active_count = 0
    max_concurrent = 0

    def fake_solve(*args, **kwargs):
        import time as _t
        nonlocal active_count, max_concurrent
        active_count += 1
        max_concurrent = max(max_concurrent, active_count)
        _t.sleep(0.05)
        active_count -= 1
        return solver.SolveResult(status="OPTIMAL", objective=0.0, assignments=[])

    monkeypatch.setattr(solver, "solve", fake_solve)

    await asyncio.gather(
        generator_router._run_solver([], [], 5, 1, []),
        generator_router._run_solver([], [], 5, 1, []),
    )
    assert max_concurrent == 1
