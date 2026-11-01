from app.core.time import today_local, now_local
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
import asyncio
import hashlib
import inspect
import json
import logging
import multiprocessing
import os
import tempfile
import time
import uuid
import ortools
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.orm.attributes import flag_modified

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
    teacher_room: str | None = None
    second_teacher_room: str | None = None


@dataclass(slots=True)
class _ConstraintSnapshot:
    teacher_id: int
    day_of_week: int
    lesson_number: int | None
    is_hard_constraint: bool


def _init_solver_worker() -> None:
    try:
        os.nice(5)
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
            teacher_room=getattr(getattr(c, "teacher", None), "room", None),
            second_teacher_room=getattr(getattr(c, "second_teacher", None), "room", None),
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
            draft_quality = solver.evaluate_quality(curriculums, (), hints)
            if draft_quality.get("symmetry_percent", 0) >= 60:
                return list(hints)
            hints.clear()

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


def _solver_kwargs(settings: GeneratorSettings, progress_path: str | None = None) -> dict:
    kwargs = {
        "weights": settings.priorities.to_weights(),
        "optimization_time_seconds": settings.optimization_time_seconds,
        "use_file_hints": settings.hint_mode == "previous",
    }
    if progress_path is not None:
        kwargs["progress_path"] = progress_path
    return kwargs


def _filter_solver_kwargs(solve_fn, kwargs: dict) -> dict:
    try:
        sig = inspect.signature(solve_fn)
        has_varkw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        if not has_varkw:
            valid_keys = set(sig.parameters.keys())
            return {k: v for k, v in kwargs.items() if k in valid_keys}
    except Exception:
        pass
    return kwargs


async def _run_solver(
    curriculums: list,
    constraints: list,
    max_time_in_seconds: int,
    workers: int,
    hints: list[tuple[int, int, int]],
    settings: GeneratorSettings | None = None,
    progress_path: str | None = None,
) -> solver.SolveResult:
    settings = settings or GeneratorSettings()
    solver_kwargs = _filter_solver_kwargs(
        solver.solve,
        _solver_kwargs(settings, progress_path=progress_path),
    )
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
    phase: str = "completed",
    progress_percent: int = 100,
    solutions_found: int = 0,
    started_at: str | None = None,
    quality: dict | None = None,
) -> dict:
    data = {
        "settings": settings.model_dump(),
        "weights": asdict(settings.priorities.to_weights()),
        "status": status,
        "objective": objective,
        "elapsed_seconds": round(elapsed, 1),
        "hints_used": hints_used,
        "phase": phase,
        "progress_percent": progress_percent,
        "solutions_found": solutions_found,
    }
    if started_at is not None:
        data["started_at"] = started_at
    if quality is not None:
        data["quality"] = quality
    return data


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
    progress_file = Path(tempfile.gettempdir()) / f"schedule_gen_{draft_id}_{uuid.uuid4().hex[:8]}.json"
    done_event = asyncio.Event()

    last_solutions = 0

    async def _poll_progress():
        nonlocal last_solutions
        last_pct = 5
        while not done_event.is_set():
            await asyncio.sleep(0.5)
            elapsed_cur = time.monotonic() - solve_started
            phase = "validating" if elapsed_cur < 1.2 else "feasibility"
            pct = max(last_pct, min(14, 5 + int(elapsed_cur * 5)))
            solutions = last_solutions
            if progress_file.exists():
                try:
                    pdata = json.loads(progress_file.read_text(encoding="utf-8"))
                    phase = pdata.get("phase", phase)
                    pct = max(last_pct, int(pdata.get("progress_percent", pct)))
                    solutions = int(pdata.get("solutions_found", solutions))
                except Exception:
                    pass
            last_pct = pct
            last_solutions = solutions
            try:
                async with async_session_factory() as db:
                    d = await db.get(ScheduleDraft, draft_id)
                    if d and d.status == "GENERATING":
                        gen = dict((d.data or {}).get("generation") or {})
                        gen["phase"] = phase
                        gen["progress_percent"] = pct
                        gen["solutions_found"] = solutions
                        gen["elapsed_seconds"] = round(elapsed_cur, 1)
                        d.data = {**(d.data or {}), "generation": gen}
                        flag_modified(d, "data")
                        await db.commit()
            except Exception:
                pass

    progress_task = asyncio.create_task(_poll_progress())

    try:
        async with _generation_lock:
            result = await _run_solver(
                curriculums,
                constraints,
                max_time_in_seconds,
                workers,
                hints or [],
                settings,
                progress_path=str(progress_file),
            )
    finally:
        done_event.set()
        await progress_task
        try:
            if progress_file.exists():
                try:
                    pdata = json.loads(progress_file.read_text(encoding="utf-8"))
                    last_solutions = max(last_solutions, int(pdata.get("solutions_found", 0)))
                except Exception:
                    pass
                progress_file.unlink()
        except OSError:
            pass

    elapsed = time.monotonic() - solve_started
    try:
        async with async_session_factory() as db:
            draft = await db.get(ScheduleDraft, draft_id)
            if draft is None:
                return

            saved_started_at = (
                draft.data.get("generation", {}).get("started_at")
                if draft.data and isinstance(draft.data, dict)
                else None
            )

            if not result.ok:
                draft.status = result.status
                draft.data = {
                    **(draft.data or {}),
                    "generation": _generation_summary(
                        settings,
                        status=result.status,
                        elapsed=elapsed,
                        objective=result.objective,
                        hints_used=len(hints or []),
                        phase="failed",
                        progress_percent=100,
                        started_at=saved_started_at,
                    ),
                }
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

            # Phase: saving
            draft.data = {
                **(draft.data or {}),
                "generation": _generation_summary(
                    settings,
                    status="GENERATING",
                    elapsed=elapsed,
                    objective=result.objective,
                    hints_used=len(hints or []),
                    phase="saving",
                    progress_percent=95,
                    solutions_found=last_solutions,
                    started_at=saved_started_at,
                ),
            }
            flag_modified(draft, "data")
            await db.commit()

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
            quality_report = solver.evaluate_quality(
                curriculums,
                constraints,
                result.assignments,
            )
            draft.status = "DRAFT"
            draft.data = {
                **(draft.data or {}),
                "generation": _generation_summary(
                    settings,
                    status=result.status,
                    elapsed=time.monotonic() - solve_started,
                    objective=result.objective,
                    hints_used=len(hints or []),
                    phase="completed",
                    progress_percent=100,
                    solutions_found=last_solutions,
                    started_at=saved_started_at,
                    quality=quality_report,
                ),
            }
            flag_modified(draft, "data")
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

    # In production, ensure generator has at least a 300s budget and 180s optimization time,
    # preventing stale database settings (e.g. legacy 30s/35s) from aborting generation prematurely.
    if "PYTEST_CURRENT_TEST" not in os.environ:
        forced_max_time = max(run_settings.max_time_seconds, 300)
        forced_opt_time = max(run_settings.optimization_time_seconds, 180)
        run_settings = run_settings.model_copy(
            update={"max_time_seconds": forced_max_time, "optimization_time_seconds": forced_opt_time}
        )

    query = select(Curriculum).options(
        joinedload(Curriculum.group),
        joinedload(Curriculum.subject),
        joinedload(Curriculum.teacher),
        joinedload(Curriculum.second_teacher),
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

    # Автоматично закріплюємо виховні години на 4-ту пару четверга, якщо вони ще не закріплені
    healed_any = False
    for c in curriculums:
        subj_name = getattr(c.subject, "name", "")
        if subj_name == "Виховна година":
            if (
                getattr(c, "strict_day", None) != 4
                or getattr(c, "strict_lesson", None) != 4
                or not getattr(c, "is_fixed", False)
                or getattr(c, "pairs_per_2_weeks", 0) != 2
            ):
                c.strict_day = 4
                c.strict_lesson = 4
                c.is_fixed = True
                c.pairs_per_2_weeks = 2
                c.require_week = None
                healed_any = True
    if healed_any:
        await db.commit()

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

    started_at_iso = datetime.now(timezone.utc).isoformat()
    draft = ScheduleDraft(
        name=f"Генерація від {now_local().strftime('%d.%m %H:%M')}",
        draft_type="generated",
        status="GENERATING",
        data={
            "generation": _generation_summary(
                run_settings,
                status="GENERATING",
                elapsed=0.0,
                hints_used=len(hints),
                phase="validating",
                progress_percent=5,
                solutions_found=0,
                started_at=started_at_iso,
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
