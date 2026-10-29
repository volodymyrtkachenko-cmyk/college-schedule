from app.core.time import today_local, now_local
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime
from functools import partial
import asyncio
import hashlib
import json
import logging
import multiprocessing
import os
import time
import ortools
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload

from app.database import async_session_factory, get_db
from app.models import Curriculum, TeacherConstraint, ScheduleDraft, ScheduleSlot, Schedule, Teacher
from app.models.entities import User
from app.schemas.constraint import ScheduleDraftResponse
from app.core.security import require_roles
from app.services import solver
from app.services.generator_settings import (
    GeneratorRunOptions,
    GeneratorSettings,
    apply_overrides,
    get_generator_settings,
    save_generator_settings,
)

router = APIRouter(prefix="/generator", tags=["Generator"])
logger = logging.getLogger(__name__)

_DEFAULT_SOLVE = solver.solve
_solver_pool: ProcessPoolExecutor | None = None


@dataclass(slots=True)
class _GroupSnapshot:
    id: int
    name: str
    curator_id: int | None


@dataclass(slots=True)
class _SubjectSnapshot:
    id: int
    name: str


@dataclass(slots=True)
class _CurriculumSnapshot:
    id: int
    group_id: int
    subject_id: int
    teacher_id: int
    second_teacher_id: int | None
    pairs_per_2_weeks: int
    is_stream: bool
    stream_id: str | None
    is_fixed: bool
    strict_day: int | None
    strict_lesson: int | None
    require_week: str | None
    allow_multiple_per_day: bool
    group: _GroupSnapshot | None
    subject: _SubjectSnapshot | None


@dataclass(slots=True)
class _ConstraintSnapshot:
    teacher_id: int
    day_of_week: int
    lesson_number: int | None
    is_hard_constraint: bool


def _init_solver_worker() -> None:
    try:
        os.nice(15)
    except (AttributeError, OSError):
        pass


def _get_solver_pool() -> ProcessPoolExecutor:
    global _solver_pool
    if _solver_pool is None:
        _solver_pool = ProcessPoolExecutor(
            max_workers=1,
            mp_context=multiprocessing.get_context("spawn"),
            initializer=_init_solver_worker,
        )
    return _solver_pool


def _snapshot_inputs(
    curriculums: list,
    constraints: list,
) -> tuple[list[_CurriculumSnapshot], list[_ConstraintSnapshot]]:
    curr_snapshots = [
        _CurriculumSnapshot(
            id=c.id,
            group_id=c.group_id,
            subject_id=c.subject_id,
            teacher_id=c.teacher_id,
            second_teacher_id=c.second_teacher_id,
            pairs_per_2_weeks=c.pairs_per_2_weeks,
            is_stream=bool(c.is_stream),
            stream_id=c.stream_id,
            is_fixed=bool(c.is_fixed),
            strict_day=c.strict_day,
            strict_lesson=c.strict_lesson,
            require_week=getattr(c, "require_week", None),
            allow_multiple_per_day=bool(getattr(c, "allow_multiple_per_day", False)),
            group=(
                _GroupSnapshot(
                    id=c.group.id,
                    name=c.group.name,
                    curator_id=getattr(c.group, "curator_id", None),
                )
                if getattr(c, "group", None) is not None
                else None
            ),
            subject=(
                _SubjectSnapshot(id=c.subject.id, name=c.subject.name)
                if getattr(c, "subject", None) is not None
                else None
            ),
        )
        for c in curriculums
    ]
    cons_snapshots = [
        _ConstraintSnapshot(
            teacher_id=c.teacher_id,
            day_of_week=c.day_of_week,
            lesson_number=c.lesson_number,
            is_hard_constraint=bool(getattr(c, "is_hard_constraint", True)),
        )
        for c in constraints
    ]
    return curr_snapshots, cons_snapshots


async def _load_db_hints(
    db: AsyncSession,
    curriculums: list,
) -> list[tuple[int, int, int]]:
    by_id = {c.id: c for c in curriculums}
    hints: set[tuple[int, int, int]] = set()

    latest_draft_id = await db.scalar(
        select(ScheduleDraft.id)
        .where(
            ScheduleDraft.draft_type == "generated",
            ScheduleDraft.status.in_(("DRAFT", "PUBLISHED")),
        )
        .order_by(ScheduleDraft.id.desc())
        .limit(1)
    )
    if latest_draft_id is not None:
        slots = (
            await db.scalars(
                select(ScheduleSlot).where(ScheduleSlot.draft_id == latest_draft_id)
            )
        ).all()
        for sl in slots:
            if sl.curriculum_id not in by_id or not sl.lesson_number or not sl.day_of_week:
                continue
            d_base = int(sl.day_of_week) - 1
            s_idx = int(sl.lesson_number) - 1
            if not (0 <= d_base < solver.DAYS and 0 <= s_idx < solver.SLOTS):
                continue
            if sl.week_type in ("numerator", "both"):
                hints.add((sl.curriculum_id, d_base, s_idx))
            if sl.week_type in ("denominator", "both"):
                hints.add((sl.curriculum_id, d_base + solver.DAYS, s_idx))
        if hints:
            return list(hints)

    by_key: dict[tuple[int, int | None, int], list[int]] = {}
    for c in curriculums:
        by_key.setdefault((c.group_id, c.teacher_id, c.subject_id), []).append(c.id)

    active_rows = (
        await db.scalars(
            select(Schedule).where(
                Schedule.is_active == True,
                Schedule.is_replacement == False,
            )
        )
    ).all()
    for row in active_rows:
        if not row.lesson_number or not row.day_of_week:
            continue
        matches = by_key.get((row.group_id, row.teacher_id, row.subject_id), [])
        if not matches:
            continue
        c_id = matches[0]
        d_base = int(row.day_of_week) - 1
        s_idx = int(row.lesson_number) - 1
        if not (0 <= d_base < solver.DAYS and 0 <= s_idx < solver.SLOTS):
            continue
        if row.week_type in ("numerator", "both"):
            hints.add((c_id, d_base, s_idx))
        if row.week_type in ("denominator", "both"):
            hints.add((c_id, d_base + solver.DAYS, s_idx))
    return list(hints)


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


_generation_lock = asyncio.Lock()


def _solver_kwargs(settings: GeneratorSettings) -> dict:
    return {
        "weights": settings.priorities.to_weights(),
        "optimization_time_seconds": settings.optimization_time_seconds,
        "use_file_hints": settings.hint_mode == "previous",
    }


async def _run_solver(
    curriculums: list,
    constraints: list,
    max_time_in_seconds: int,
    workers: int,
    hints: list[tuple[int, int, int]],
    settings: GeneratorSettings | None = None,
) -> solver.SolveResult:
    settings = settings or GeneratorSettings()
    solver_kwargs = _solver_kwargs(settings)
    use_subprocess = (
        solver.solve is _DEFAULT_SOLVE
        and "PYTEST_CURRENT_TEST" not in os.environ
    )
    if use_subprocess:
        curr_snapshots, cons_snapshots = _snapshot_inputs(curriculums, constraints)
        try:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(
                _get_solver_pool(),
                partial(
                    solver.solve,
                    curr_snapshots,
                    cons_snapshots,
                    max_time_in_seconds,
                    workers,
                    hints=hints,
                    **solver_kwargs,
                ),
            )
        except Exception:
            global _solver_pool
            _solver_pool = None
            logger.warning("Subprocess solver failed; falling back to thread", exc_info=True)

    return await asyncio.to_thread(
        partial(
            solver.solve,
            curriculums,
            constraints,
            max_time_in_seconds,
            workers,
            hints=hints,
            **solver_kwargs,
        )
    )


def _generation_summary(
    settings: GeneratorSettings,
    *,
    status: str,
    elapsed: float,
    objective: float | None = None,
    hints_used: int = 0,
) -> dict:
    return {
        "settings": settings.model_dump(),
        "weights": asdict(settings.priorities.to_weights()),
        "status": status,
        "objective": objective,
        "elapsed_seconds": round(elapsed, 1),
        "hints_used": hints_used,
    }


async def _complete_generation(
    draft_id: int,
    curriculums: list,
    constraints: list,
    max_time_in_seconds: int,
    hints: list[tuple[int, int, int]] | None = None,
    settings: GeneratorSettings | None = None,
) -> None:
    settings = settings or GeneratorSettings().model_copy(
        update={"max_time_seconds": max_time_in_seconds}
    )
    diagnostics = _solver_input_diagnostics(curriculums, constraints)
    solve_started = time.monotonic()
    workers = solver.selected_worker_count()
    try:
        async with _generation_lock:
            result = await _run_solver(
                curriculums,
                constraints,
                max_time_in_seconds,
                workers,
                hints or [],
                settings,
            )
        elapsed = time.monotonic() - solve_started
        summary = _generation_summary(
            settings,
            status=result.status,
            elapsed=elapsed,
            objective=result.objective,
            hints_used=len(hints or []),
        )
        async with async_session_factory() as db:
            draft = await db.get(ScheduleDraft, draft_id)
            if draft is None:
                return
            draft.data = {**(draft.data or {}), "generation": summary}
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
                    elapsed,
                    workers,
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


@router.get("/settings", response_model=GeneratorSettings)
async def read_generator_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    return await get_generator_settings(db)


@router.put("/settings", response_model=GeneratorSettings)
async def update_generator_settings(
    payload: GeneratorSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    return await save_generator_settings(db, payload)


@router.post("", response_model=ScheduleDraftResponse, status_code=202)
async def generate_schedule(
    background_tasks: BackgroundTasks,
    max_time_in_seconds: int | None = Query(default=None, gt=0),
    options: GeneratorRunOptions | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "editor"))
):
    if _generation_lock.locked():
        existing_generating = await db.scalar(
            select(ScheduleDraft)
            .where(ScheduleDraft.status == "GENERATING")
            .order_by(ScheduleDraft.id.desc())
            .limit(1)
        )
        if existing_generating is not None:
            return existing_generating

    # Saved global settings → per-run overrides → legacy query parameter.
    run_settings = apply_overrides(await get_generator_settings(db), options)
    if max_time_in_seconds is not None and (options is None or options.max_time_seconds is None):
        run_settings = run_settings.model_copy(update={"max_time_seconds": max_time_in_seconds})

    query = select(Curriculum).options(
        joinedload(Curriculum.group),
        joinedload(Curriculum.subject),
    )
    if current_user.role == "editor":
        u = await db.scalar(select(User).options(selectinload(User.allowed_groups)).where(User.id == current_user.id))
        user_groups = [g.id for g in u.allowed_groups] if u else []
        if not user_groups:
            raise HTTPException(status_code=403, detail="Немає доступу до жодної групи")
        query = query.where(Curriculum.group_id.in_(user_groups))
        
    curriculums = (await db.scalars(query)).all()
    constraints = (await db.scalars(select(TeacherConstraint))).all()

    if not curriculums:
        raise HTTPException(status_code=400, detail="Немає навантаження для генерації.")

    # Вимоги до розкладу: кожен день групи має містити 3 або 4 пари,
    # без вікон. Вільні дні та вікна викладачів дозволені.
    teacher_ids = {
        t for c in curriculums for t in (c.teacher_id, c.second_teacher_id) if t
    }
    teacher_names = dict(
        (await db.execute(select(Teacher.id, Teacher.name).where(Teacher.id.in_(teacher_ids)))).all()
    ) if teacher_ids else {}
    problems = solver.precheck(curriculums, constraints, teacher_names)
    if problems:
        raise HTTPException(
            status_code=400,
            detail="Неможливо скласти розклад за заданими вимогами: " + "; ".join(problems),
        )

    hints = await _load_db_hints(db, curriculums) if run_settings.hint_mode == "previous" else []

    draft = ScheduleDraft(
        name=f"Генерація від {now_local().strftime('%d.%m %H:%M')}",
        draft_type="generated",
        status="GENERATING",
        data={
            "generation": _generation_summary(
                run_settings, status="GENERATING", elapsed=0.0, hints_used=len(hints)
            )
        },
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    background_tasks.add_task(
        _complete_generation,
        draft.id,
        list(curriculums),
        list(constraints),
        run_settings.max_time_seconds,
        hints,
        run_settings,
    )
    return draft
