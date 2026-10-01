from datetime import datetime
import hashlib
import json
import logging
import time
import ortools
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
import asyncio

from app.database import get_db
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


@router.post("", response_model=ScheduleDraftResponse)
async def generate_schedule(
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

    # Вимоги до розкладу: Пн–Пт кожен день, щонайменше 3 пари, без вікон (1–2 пар бути не може).
    # Якщо навантаження цього не дозволяє — одразу пояснюємо, де саме проблема.
    problems = solver.precheck(curriculums, constraints)
    if problems:
        raise HTTPException(
            status_code=400,
            detail="Неможливо скласти розклад за заданими вимогами: " + "; ".join(problems),
        )

    # Розв'язуємо в окремому потоці, щоб не блокувати event loop
    solve_started = time.monotonic()
    result = await asyncio.to_thread(solver.solve, list(curriculums), list(constraints), max_time_in_seconds)
    if not result.ok:
        if result.status == "INFEASIBLE":
            detail = (
                "Неможливо скласти розклад: обмеження розкладу несумісні "
                "(3–4 пари щодня Пн–Пт, без вікон, доступність викладачів, потоки та закріплені пари). "
                "Перевірте закріплені пари й обмеження викладачів."
            )
        elif result.status == "TIMEOUT":
            diagnostics = _solver_input_diagnostics(curriculums, constraints)
            diagnostic_text = (
                f"curriculums={diagnostics['curriculums']}, groups={diagnostics['groups']}, "
                f"teacher_constraints={diagnostics['teacher_constraints']}, "
                f"fingerprint={diagnostics['fingerprint']}, "
                f"elapsed={time.monotonic() - solve_started:.1f}s, "
                f"workers={solver.DEFAULT_NUM_WORKERS}, ortools={ortools.__version__}"
            )
            logger.warning("Schedule generation timed out: %s", diagnostic_text)
            detail = (
                f"Пошук не знайшов розклад за {max_time_in_seconds} с і не зміг довести неможливість. "
                "Це таймаут пошуку, а не підтвердження неможливості. "
                f"Діагностика: {diagnostic_text}."
            )
        else:
            detail = f"Помилка моделі генератора розкладу: {result.status}."
        raise HTTPException(
            status_code=400,
            detail=detail,
        )

    draft = ScheduleDraft(name=f"Генерація від {datetime.now().strftime('%d.%m %H:%M')}", status="DRAFT")
    db.add(draft)
    await db.flush()  # отримати draft.id

    db.add_all([
        ScheduleSlot(
            draft_id=draft.id,
            curriculum_id=c_id,
            day_of_week=(d % solver.DAYS) + 1,
            lesson_number=s + 1,
            week_type="numerator" if d < solver.DAYS else "denominator",
        )
        for (c_id, d, s) in result.assignments
    ])
    await db.commit()
    return draft
