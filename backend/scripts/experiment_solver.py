import asyncio
import os
import sys
import time

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from sqlalchemy.orm import joinedload
from app.database import async_session_factory
from app.models.entities import Curriculum, TeacherConstraint, Group, Teacher
from app.services.solver import solve, evaluate_quality, SolverWeights


async def run_experiment():
    async with async_session_factory() as db:
        query = select(Curriculum).options(
            joinedload(Curriculum.group),
            joinedload(Curriculum.subject),
            joinedload(Curriculum.teacher),
            joinedload(Curriculum.second_teacher),
        )
        currs = (await db.scalars(query)).all()
        cons = (await db.scalars(select(TeacherConstraint))).all()
        teachers = (await db.scalars(select(Teacher))).all()
        t_names = {t.id: t.name for t in teachers}

        # Load hints from latest good draft (e.g. #233)
        from app.models.entities import ScheduleSlot, ScheduleDraft
        latest_good_draft = await db.scalar(
            select(ScheduleDraft.id)
            .where(
                ScheduleDraft.draft_type == "generated",
                ScheduleDraft.status.in_(("DRAFT", "PUBLISHED", "draft")),
            )
            .order_by(ScheduleDraft.id.desc())
            .limit(1)
        )
        hints = []
        if latest_good_draft:
            slots = (await db.scalars(select(ScheduleSlot).where(ScheduleSlot.draft_id == latest_good_draft))).all()
            for sl in slots:
                if sl.curriculum_id and sl.day_of_week and sl.lesson_number:
                    d_idx = (sl.day_of_week - 1) + (5 if getattr(sl, "week_type", "numerator") == "denominator" else 0)
                    hints.append((sl.curriculum_id, d_idx, sl.lesson_number - 1))
        print(f"Loaded: {len(currs)} curriculums, {len(cons)} constraints, {len(teachers)} teachers, {len(hints)} hints from draft #{latest_good_draft}")

        print(f"Loaded: {len(currs)} curriculums, {len(cons)} constraints, {len(teachers)} teachers")

        weights = SolverWeights(
            subject_slot_symmetry=8000,
            late_start=50,
            teacher_windows=4000,
            teacher_single_lesson_day=2000,
            teacher_active_day=500,
            teacher_four_lessons_day=250,
            group_week_balance=1000,
            subject_week_balance=1000,
            three_consecutive_days=200,
            soft_teacher_constraints=3000,
            shared_room_conflict=0,
            curator_thursday_priority=1000,
        )

        print("\n--- Starting Solver Run (Budget: 50s continuous) ---")
        t0 = time.time()
        result = solve(
            currs,
            cons,
            max_time_in_seconds=70,
            optimization_time_seconds=50,
            num_workers=2,
            weights=weights,
            hints=hints,
        )
        elapsed = time.time() - t0
        print(f"Status: {result.status}, Objective: {result.objective}, Elapsed: {elapsed:.1f}s")

        if result.status in ("FEASIBLE", "OPTIMAL"):
            q = evaluate_quality(currs, cons, result.assignments, teacher_names=t_names)
            print("\n=== QUALITY EVALUATION ===")
            print(f"Overall Quality Score: {q.get('quality_score')}/100")
            print(f"Symmetry: {q.get('symmetry_percent')}%")
            print(f"Late starts (start 1st): {q.get('first_lesson_start_percent')}% (Late starts count: {len(q.get('late_starts', []))})")
            tw = q.get('teacher_windows', [])
            dtw = [w for w in tw if w.get('is_double')]
            print(f"Teacher windows: {len(tw)} (Double: {len(dtw)})")
            print(f"Teacher single-lesson days: {len(q.get('teacher_single_pair_days', []))}")
            print(f"Free teacher days: {q.get('methodical_days_count')}")


if __name__ == "__main__":
    asyncio.run(run_experiment())
