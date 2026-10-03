from app.core.time import today_local, now_local
from datetime import datetime
import hashlib
import json
import logging
import ortools
import time
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
import asyncio

from app.database import async_session_factory, get_db
from app.models import Curriculum, TeacherConstraint, ScheduleDraft, ScheduleSlot
from app.schemas.constraint import ScheduleDraftResponse
from app.core.security import require_roles
from app.services import solver

router = APIRouter(prefix="/generator", tags=["Generator"])
logger = logging.getLogger(__name__)


def _solver_input_diagnostics(curriculums, constraints) -> dict[str, int | str]:
    curriculum_rows = [
        (
            c.id,
            c.group_id,
            c.subject_id,
            c.teacher_id,
            c.second_teacher_id,
            c.pairs_per_2_weeks,
            c.is_stream,
            c.stream_id,
            c.is_fixed,
            c.strict_day,
            c.strict_lesson,
            c.require_week,
            c.allow_multiple_per_day,
            getattr(c.group, "curator_id", None),
        )
        for c in curriculums
    ]
    constraint_rows = [
        (c.teacher_id, c.day_of_week, c.lesson_number, c.is_hard_constraint)
        for c in constraints
    ]
    fingerprint_data = json.dumps(
        (sorted(curriculum_rows), sorted(constraint_rows)),
        separators=(",", ":"),
    ).encode()
    return {
        "curriculums": len(curriculums),
        "groups": len({c.group_id for c in curriculums}),
        "teacher_constraints": len(constraints),
        "fingerprint": hashlib.sha256(fingerprint_data).hexdigest()[:12],
    }


async def _complete_generation(
    draft_id: int,
    curriculums: list,
    constraints: list,
    max_time_in_seconds: int,
) -> None:
    diagnostics = _solver_input_diagnostics(curriculums, constraints)
    solve_started = time.monotonic()
    try:
        result = await asyncio.to_thread(
            solver.solve,
            curriculums,
            constraints,
            max_time_in_seconds,
        )
        async with async_session_factory() as db:
            draft = await db.get(ScheduleDraft, draft_id)
            if draft is None:
                return
            if not result.ok:
                draft.status = result.status
                logger.warning(
                    "Schedule generation failed: status=%s curriculums=%s groups=%s "
                    "teacher_constraints=%s fingerprint=%s elapsed=%.1fs workers=%s ortools=%s",
                    result.status,
                    diagnostics["curriculums"],
                    diagnostics["groups"],
                    diagnostics["teacher_constraints"],
                    diagnostics["fingerprint"],
                    time.monotonic() - solve_started,
                    solver.selected_worker_count(),
                    ortools.__version__,
                )
                await db.commit()
                return

            db.add_all([
                ScheduleSlot(
                    draft_id=draft.id,
                    curriculum_id=c_id,
                    day_of_week=(d % solver.DAYS) + 1,
                    lesson_number=s + 1,
                    week_type="numerator" if d < solver.DAYS else "denominator",
                )
                for c_id, d, s in result.assignments
            ])
            draft.status = "DRAFT"
            await db.commit()
    except Exception:
        logger.exception(
            "Schedule generation task failed: draft_id=%s fingerprint=%s",
            draft_id,
            diagnostics["fingerprint"],
        )
        async with async_session_factory() as db:
            draft = await db.get(ScheduleDraft, draft_id)
            if draft is not None:
                draft.status = "FAILED"
                await db.commit()


@router.post("", response_model=ScheduleDraftResponse, status_code=202)
async def generate_schedule(
    background_tasks: BackgroundTasks,
    max_time_in_seconds: int = Query(default=solver.DEFAULT_SOLVE_TIME_SECONDS, gt=0),
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    curriculums = (
        await db.scalars(
            select(Curriculum).options(
                joinedload(Curriculum.group),
                joinedload(Curriculum.subject),
            )
        )
    ).all()
    constraints = (await db.scalars(select(TeacherConstraint))).all()

    if not curriculums:
        raise HTTPException(status_code=400, detail="Немає навантаження для генерації.")

    # Вимоги до розкладу: кожен день групи має містити 3 або 4 пари,
    # без вікон. Вільні дні та вікна викладачів дозволені.
    problems = solver.precheck(curriculums, constraints)
    if problems:
        raise HTTPException(
            status_code=400,
            detail="Неможливо скласти розклад за заданими вимогами: " + "; ".join(problems),
        )

    draft = ScheduleDraft(
        name=f"Генерація від {now_local().strftime('%d.%m %H:%M')}",
        draft_type="generated",
        status="GENERATING",
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    background_tasks.add_task(
        _complete_generation,
        draft.id,
        list(curriculums),
        list(constraints),
        max_time_in_seconds,
    )
    return draft
