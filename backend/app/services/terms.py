from typing import Optional
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import AcademicTerm, TermCourseSchedule, Curriculum, TeacherConstraint


async def get_active_term(db: AsyncSession) -> Optional[AcademicTerm]:
    """Return current active academic term."""
    term = await db.scalar(
        select(AcademicTerm)
        .options(selectinload(AcademicTerm.course_schedules))
        .where(AcademicTerm.is_current.is_(True))
        .limit(1)
    )
    if term is None:
        term = await db.scalar(
            select(AcademicTerm)
            .options(selectinload(AcademicTerm.course_schedules))
            .order_by(AcademicTerm.id.desc())
            .limit(1)
        )
    return term


async def get_term_by_id(db: AsyncSession, term_id: int) -> Optional[AcademicTerm]:
    """Return academic term by ID with its course schedules."""
    return await db.scalar(
        select(AcademicTerm)
        .options(selectinload(AcademicTerm.course_schedules))
        .where(AcademicTerm.id == term_id)
    )


async def get_term_theory_weeks(db: AsyncSession, term_id: int, course: int) -> int:
    """Return theory weeks for given course in the specified term."""
    sched = await db.scalar(
        select(TermCourseSchedule).where(
            TermCourseSchedule.term_id == term_id,
            TermCourseSchedule.course == course,
        )
    )
    if sched is not None:
        return sched.theory_weeks
    term = await db.get(AcademicTerm, term_id)
    return term.total_weeks if term else 17


def calculate_workload(
    theory_weeks: int,
    total_hours: Optional[int] = None,
    pairs_per_2_weeks: Optional[int] = None,
) -> dict:
    """
    Two-way automatic calculator:
    1 lesson = 2 academic hours.
    Pairs total = total_hours / 2.
    pairs_per_2_weeks = round((pairs_total / theory_weeks) * 2)
    total_hours = round((pairs_per_2_weeks / 2) * theory_weeks) * 2
    """
    theory_weeks = max(1, theory_weeks or 17)

    res_hours = total_hours or 0
    res_pairs = pairs_per_2_weeks or 0

    if total_hours is not None and total_hours > 0 and (pairs_per_2_weeks is None or pairs_per_2_weeks == 0):
        pairs_total = total_hours / 2.0
        calculated_pairs = round((pairs_total / theory_weeks) * 2.0)
        res_pairs = max(1, calculated_pairs) if total_hours > 0 else 0
        res_hours = total_hours
    elif pairs_per_2_weeks is not None and pairs_per_2_weeks > 0:
        calculated_hours = round((pairs_per_2_weeks / 2.0) * theory_weeks) * 2
        res_hours = calculated_hours
        res_pairs = pairs_per_2_weeks

    return {
        "theory_weeks": theory_weeks,
        "total_hours": res_hours,
        "pairs_per_2_weeks": res_pairs,
    }


async def clone_term_workload(
    db: AsyncSession,
    source_term_id: int,
    target_term_id: int,
    recalculate_hours: bool = True,
) -> dict:
    """
    Clone all curriculums and teacher constraints from source term to target term.
    Enables teachers and admins to prepare the next semester without touching current semester data.
    """
    source_term = await get_term_by_id(db, source_term_id)
    target_term = await get_term_by_id(db, target_term_id)
    if not source_term or not target_term:
        raise ValueError("Source or target academic term not found")

    target_theory_by_course = {
        cs.course: cs.theory_weeks for cs in target_term.course_schedules
    }

    # Fetch source curriculums
    src_curriculums = (
        await db.scalars(
            select(Curriculum)
            .options(selectinload(Curriculum.group))
            .where(Curriculum.term_id == source_term_id)
        )
    ).all()

    # Clear any existing target curriculums for a clean clone
    existing_target = (
        await db.scalars(
            select(Curriculum).where(Curriculum.term_id == target_term_id)
        )
    ).all()
    existing_keys = {
        (c.group_id, c.subject_id, c.teacher_id, c.second_teacher_id, c.is_stream, c.stream_id)
        for c in existing_target
    }

    cloned_curriculums = 0
    for sc in src_curriculums:
        key = (sc.group_id, sc.subject_id, sc.teacher_id, sc.second_teacher_id, sc.is_stream, sc.stream_id)
        if key in existing_keys:
            continue

        pairs = sc.pairs_per_2_weeks
        hours = sc.total_hours

        if recalculate_hours and sc.group:
            course = sc.group.course or 1
            target_theory = target_theory_by_course.get(course, target_term.total_weeks)
            calc = calculate_workload(target_theory, pairs_per_2_weeks=pairs)
            hours = calc["total_hours"]

        new_c = Curriculum(
            term_id=target_term_id,
            group_id=sc.group_id,
            subject_id=sc.subject_id,
            teacher_id=sc.teacher_id,
            second_teacher_id=sc.second_teacher_id,
            pairs_per_2_weeks=pairs,
            total_hours=hours,
            is_stream=sc.is_stream,
            stream_id=sc.stream_id,
            strict_day=sc.strict_day,
            strict_lesson=sc.strict_lesson,
            require_week=sc.require_week,
            allow_multiple_per_day=sc.allow_multiple_per_day,
            is_fixed=sc.is_fixed,
        )
        db.add(new_c)
        cloned_curriculums += 1

    # Fetch source teacher constraints
    src_constraints = (
        await db.scalars(
            select(TeacherConstraint).where(TeacherConstraint.term_id == source_term_id)
        )
    ).all()
    existing_constraints = (
        await db.scalars(
            select(TeacherConstraint).where(TeacherConstraint.term_id == target_term_id)
        )
    ).all()
    existing_c_keys = {
        (tc.teacher_id, tc.day_of_week, tc.lesson_number) for tc in existing_constraints
    }

    cloned_constraints = 0
    for tc in src_constraints:
        c_key = (tc.teacher_id, tc.day_of_week, tc.lesson_number)
        if c_key in existing_c_keys:
            continue
        new_tc = TeacherConstraint(
            term_id=target_term_id,
            teacher_id=tc.teacher_id,
            day_of_week=tc.day_of_week,
            lesson_number=tc.lesson_number,
            is_hard_constraint=tc.is_hard_constraint,
        )
        db.add(new_tc)
        cloned_constraints += 1

    await db.commit()
    return {
        "cloned_curriculums": cloned_curriculums,
        "cloned_constraints": cloned_constraints,
    }