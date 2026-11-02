from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.core.security import require_roles
from app.models.entities import AcademicTerm, TermCourseSchedule, User
from app.schemas.terms import (
    AcademicTermCreate,
    AcademicTermUpdate,
    AcademicTermResponse,
    CloneTermRequest,
    WorkloadCalculationResponse,
)
from app.services.terms import (
    get_active_term,
    get_term_by_id,
    get_term_theory_weeks,
    calculate_workload,
    clone_term_workload,
)

router = APIRouter(prefix="/terms", tags=["Academic Terms"])


@router.get("", response_model=List[AcademicTermResponse])
@router.get("/", response_model=List[AcademicTermResponse])
async def list_terms(db: AsyncSession = Depends(get_db)):
    """List all academic terms with their course schedules."""
    terms = (
        await db.scalars(
            select(AcademicTerm)
            .options(selectinload(AcademicTerm.course_schedules))
            .order_by(AcademicTerm.start_date.desc(), AcademicTerm.id.desc())
        )
    ).all()
    return terms


@router.get("/active", response_model=AcademicTermResponse)
async def get_current_term(db: AsyncSession = Depends(get_db)):
    """Get the currently active academic term."""
    term = await get_active_term(db)
    if not term:
        raise HTTPException(status_code=404, detail="Активний семестр не знайдено")
    return term


@router.get("/calculate", response_model=WorkloadCalculationResponse)
async def calculate_workload_endpoint(
    term_id: Optional[int] = Query(None),
    course: int = Query(..., ge=1, le=4),
    total_hours: Optional[int] = Query(None, ge=0),
    pairs_per_2_weeks: Optional[int] = Query(None, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """
    Two-way automatic calculation endpoint between total_hours and pairs_per_2_weeks.
    Uses course practice schedule and theory weeks for the selected term.
    """
    target_term_id = term_id
    if not target_term_id:
        active = await get_active_term(db)
        target_term_id = active.id if active else 1

    theory_weeks = await get_term_theory_weeks(db, target_term_id, course)
    result = calculate_workload(
        theory_weeks=theory_weeks,
        total_hours=total_hours,
        pairs_per_2_weeks=pairs_per_2_weeks,
    )
    return result


@router.get("/{id}", response_model=AcademicTermResponse)
async def get_term(id: int, db: AsyncSession = Depends(get_db)):
    """Get specific academic term details."""
    term = await get_term_by_id(db, id)
    if not term:
        raise HTTPException(status_code=404, detail="Семестр не знайдено")
    return term


@router.post("", response_model=AcademicTermResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AcademicTermResponse, status_code=status.HTTP_201_CREATED)
async def create_term(
    payload: AcademicTermCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles("admin")),
):
    """Create a new academic term for planning or active schedule."""
    if payload.is_current:
        # Deactivate other terms
        await db.execute(update(AcademicTerm).values(is_current=False))

    term = AcademicTerm(
        name=payload.name,
        academic_year=payload.academic_year,
        semester_number=payload.semester_number,
        start_date=payload.start_date,
        end_date=payload.end_date,
        total_weeks=payload.total_weeks,
        is_current=payload.is_current,
        status=payload.status,
    )
    db.add(term)
    await db.flush()

    # Create schedules for courses 1..4
    provided_schedules = {cs.course: cs for cs in (payload.course_schedules or [])}
    for course_num in range(1, 5):
        cs_data = provided_schedules.get(course_num)
        practice_w = cs_data.practice_weeks if cs_data else 0
        total_w = cs_data.total_weeks if cs_data else payload.total_weeks
        theory_w = max(0, total_w - practice_w)
        timing = cs_data.practice_timing if cs_data else ("NONE" if practice_w == 0 else "MIDDLE")
        start_w = cs_data.practice_start_week if cs_data else None
        end_w = cs_data.practice_end_week if cs_data else None

        course_sched = TermCourseSchedule(
            term_id=term.id,
            course=course_num,
            total_weeks=total_w,
            practice_weeks=practice_w,
            practice_timing=timing,
            practice_start_week=start_w,
            practice_end_week=end_w,
            theory_weeks=theory_w,
        )
        db.add(course_sched)

    await db.commit()
    return await get_term_by_id(db, term.id)


@router.put("/{id}", response_model=AcademicTermResponse)
async def update_term(
    id: int,
    payload: AcademicTermUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles("admin")),
):
    """Update term properties or course practice schedule."""
    term = await get_term_by_id(db, id)
    if not term:
        raise HTTPException(status_code=404, detail="Семестр не знайдено")

    if payload.is_current is True:
        # Unset current on all other terms
        await db.execute(update(AcademicTerm).where(AcademicTerm.id != id).values(is_current=False))
        term.is_current = True
    elif payload.is_current is False:
        term.is_current = False

    if payload.name is not None:
        term.name = payload.name
    if payload.academic_year is not None:
        term.academic_year = payload.academic_year
    if payload.semester_number is not None:
        term.semester_number = payload.semester_number
    if payload.start_date is not None:
        term.start_date = payload.start_date
    if payload.end_date is not None:
        term.end_date = payload.end_date
    if payload.total_weeks is not None:
        term.total_weeks = payload.total_weeks
    if payload.status is not None:
        term.status = payload.status

    if payload.course_schedules is not None:
        existing_schedules = {cs.course: cs for cs in term.course_schedules}
        for cs_data in payload.course_schedules:
            practice_w = cs_data.practice_weeks
            total_w = cs_data.total_weeks or term.total_weeks
            theory_w = max(0, total_w - practice_w)
            if cs_data.course in existing_schedules:
                target = existing_schedules[cs_data.course]
                target.total_weeks = total_w
                target.practice_weeks = practice_w
                target.practice_timing = cs_data.practice_timing
                target.practice_start_week = cs_data.practice_start_week
                target.practice_end_week = cs_data.practice_end_week
                target.theory_weeks = theory_w
            else:
                db.add(
                    TermCourseSchedule(
                        term_id=term.id,
                        course=cs_data.course,
                        total_weeks=total_w,
                        practice_weeks=practice_w,
                        practice_timing=cs_data.practice_timing,
                        practice_start_week=cs_data.practice_start_week,
                        practice_end_week=cs_data.practice_end_week,
                        theory_weeks=theory_w,
                    )
                )

    await db.commit()
    return await get_term_by_id(db, id)


@router.post("/{id}/clone")
async def clone_workload(
    id: int,
    payload: CloneTermRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles("admin")),
):
    """Clone curriculum and teacher constraints from a previous semester into this semester."""
    target_term = await get_term_by_id(db, id)
    if not target_term:
        raise HTTPException(status_code=404, detail="Цільовий семестр не знайдено")

    result = await clone_term_workload(
        db,
        source_term_id=payload.source_term_id,
        target_term_id=id,
        recalculate_hours=payload.recalculate_hours,
    )
    return {"message": "Навантаження успішно скопійовано", **result}