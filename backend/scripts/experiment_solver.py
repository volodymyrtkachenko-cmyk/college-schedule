import asyncio
import os
import sys
import time

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from app.database import async_session_factory
from app.models.entities import Curriculum, TeacherConstraint, Group, Teacher
from app.services.solver import solve, evaluate_quality, SolverWeights


async def run_experiment():
    async with async_session_factory() as db:
        currs = (await db.scalars(select(Curriculum))).all()
        cons = (await db.scalars(select(TeacherConstraint))).all()
        teachers = (await db.scalars(select(Teacher))).all()
        t_names = {t.id: t.name for t in teachers}

    print(f"Loaded: {len(currs)} curriculums, {len(cons)} constraints, {len(teachers)} teachers")

    # Test baseline vs configurations
    print("\n--- Starting Solver Run (Budget: 45s) ---")
    t0 = time.time()
    result = solve(
        currs,
        cons,
        max_time_in_seconds=60,
        optimization_time_seconds=45,
        num_workers=2,
    )
    elapsed = time.time() - t0
    print(f"Status: {result.status}, Objective: {result.objective}, Elapsed: {elapsed:.1f}s")

    if result.status in ("FEASIBLE", "OPTIMAL"):
        q = evaluate_quality(currs, cons, result.assignments, teacher_names=t_names)
        print("\n=== QUALITY EVALUATION ===")
        print(f"Overall Quality Score: {q.get('quality_score')}/100")
        print(f"Symmetry: {q.get('symmetry_percentage')}%")
        print(f"Late starts (start 1st): {q.get('start_from_first_percentage')}% (Late starts count: {q.get('late_starts_count')})")
        print(f"Teacher windows: {q.get('teacher_windows_count')} (Double: {q.get('teacher_double_windows_count')})")
        print(f"Teacher single-lesson days: {q.get('teacher_single_lesson_days_count')}")
        print(f"Curator Thursday: {q.get('curator_thursday_count')}")
        print(f"Free teacher days: {q.get('teacher_free_days_count')}")


if __name__ == "__main__":
    asyncio.run(run_experiment())
