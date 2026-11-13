from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date, timedelta
from typing import List, Optional

from app.database import get_db
from app.models import AcademicTerm, Group, SchedulePeriod
from app.schemas.educational_process import (
    CellInfo,
    CourseProcessInfo,
    EducationalProcessMatrix,
    GroupProcessInfo,
    SemesterRangeInfo,
    WeekInfo,
)
from app.services.learning_mode import infer_year_of_admission

router = APIRouter(prefix="/educational-process", tags=["Educational Process"])

def generate_weeks(start_date: date) -> List[WeekInfo]:
    # Find the Monday of the week containing start_date
    current = start_date - timedelta(days=start_date.weekday())
    weeks = []
    # Generate 52 weeks
    for i in range(1, 53):
        end_of_week = current + timedelta(days=6)
        weeks.append(WeekInfo(week_number=i, start_date=current, end_date=end_of_week))
        current = end_of_week + timedelta(days=1)
    return weeks


def _match_period(periods: list[SchedulePeriod], week: WeekInfo) -> Optional[SchedulePeriod]:
    thursday = week.start_date + timedelta(days=3)
    for p in periods:
        if p.start_date <= thursday <= p.end_date:
            return p
    for p in periods:
        if p.start_date <= week.end_date and p.end_date >= week.start_date:
            return p
    return None


def _week_index_for_date(weeks: list[WeekInfo], target: date, *, clamp_start: bool = False) -> int:
    for w in weeks:
        if w.start_date <= target <= w.end_date:
            return w.week_number
    if clamp_start and weeks and target < weeks[0].start_date:
        return weeks[0].week_number
    return weeks[-1].week_number if weeks else 1


@router.get("", response_model=EducationalProcessMatrix)
async def get_matrix(
    academic_year_start: int = Query(..., description="Рік початку навчального року (наприклад, 2026)"),
    db: AsyncSession = Depends(get_db)
):
    start_date = date(academic_year_start, 9, 1)
    end_date = date(academic_year_start + 1, 8, 31)
    academic_year_str = f"{academic_year_start}/{academic_year_start + 1}"

    weeks = generate_weeks(start_date)

    groups_result = await db.execute(select(Group).where(Group.is_active == True).order_by(Group.name))
    all_groups = groups_result.scalars().all()

    periods_result = await db.execute(
        select(SchedulePeriod)
        .options(selectinload(SchedulePeriod.groups))
        .where(
            SchedulePeriod.start_date <= end_date,
            SchedulePeriod.end_date >= start_date
        )
        .order_by(SchedulePeriod.start_date, SchedulePeriod.id)
    )
    all_periods = periods_result.scalars().all()

    terms_result = await db.execute(
        select(AcademicTerm)
        .options(selectinload(AcademicTerm.course_schedules))
        .where(
            (AcademicTerm.academic_year == academic_year_str)
            | ((AcademicTerm.start_date <= end_date) & (AcademicTerm.end_date >= start_date))
        )
        .order_by(AcademicTerm.semester_number, AcademicTerm.start_date, AcademicTerm.id)
    )
    year_terms = [
        t for t in terms_result.scalars().all()
        if t.academic_year == academic_year_str
        or (t.start_date >= date(academic_year_start, 8, 1) and t.end_date <= date(academic_year_start + 1, 8, 31))
    ]

    semesters_info: list[SemesterRangeInfo] = []
    term_practice_by_course: dict[tuple[int, int], bool] = {}
    for term in year_terms:
        s_week = _week_index_for_date(weeks, term.start_date, clamp_start=True)
        e_week = _week_index_for_date(weeks, term.end_date, clamp_start=False)
        semesters_info.append(
            SemesterRangeInfo(
                semester_number=term.semester_number,
                name=term.name,
                start_date=term.start_date,
                end_date=term.end_date,
                start_week=s_week,
                end_week=max(s_week, e_week),
            )
        )
        term_weeks = [
            w for w in weeks
            if term.start_date <= (w.start_date + timedelta(days=3)) <= term.end_date
        ]
        for cs in term.course_schedules:
            if cs.practice_weeks > 0 and cs.practice_start_week and cs.practice_end_week:
                for offset in range(cs.practice_start_week, cs.practice_end_week + 1):
                    idx = offset - 1
                    if 0 <= idx < len(term_weeks):
                        term_practice_by_course[(cs.course, term_weeks[idx].week_number)] = True

    global_periods: list[SchedulePeriod] = []
    group_periods_map = {g.id: [] for g in all_groups}
    for p in all_periods:
        if not p.groups:
            global_periods.append(p)
        else:
            for g in p.groups:
                if g.id in group_periods_map:
                    group_periods_map[g.id].append(p)

    sem1_terms = [t for t in year_terms if t.semester_number == 1]
    sem2_terms = [t for t in year_terms if t.semester_number == 2]
    max_sem1_end = max((t.end_date for t in sem1_terms), default=None)
    min_sem2_start = min((t.start_date for t in sem2_terms), default=None)
    max_sem2_end = max((t.end_date for t in sem2_terms), default=None)

    courses_map = {}

    for group in all_groups:
        admission_year = group.year_of_admission or infer_year_of_admission(group.name)
        if not admission_year:
            continue

        course = academic_year_start - admission_year + 1
        if not (1 <= course <= 5):
            continue

        if course not in courses_map:
            courses_map[course] = []

        cells = []
        g_periods = group_periods_map[group.id]

        for w in weeks:
            thursday = w.start_date + timedelta(days=3)
            # Group-specific periods take precedence over college-wide periods
            active_period = _match_period(g_periods, w) or _match_period(global_periods, w)

            if active_period:
                cells.append(CellInfo(
                    week_number=w.week_number,
                    period_type=active_period.period_type,
                    name=active_period.name
                ))
            elif term_practice_by_course.get((course, w.week_number)):
                cells.append(CellInfo(
                    week_number=w.week_number,
                    period_type="practice",
                    name="Практика"
                ))
            elif year_terms:
                in_any_term = any(
                    t.start_date <= thursday <= t.end_date for t in year_terms
                )
                if in_any_term:
                    cells.append(CellInfo(
                        week_number=w.week_number,
                        period_type="theory",
                        name="Теоретичне навчання"
                    ))
                elif thursday.month in (7, 8) or (max_sem2_end is not None and thursday > max_sem2_end):
                    cells.append(CellInfo(
                        week_number=w.week_number,
                        period_type="holiday",
                        name="Літні канікули"
                    ))
                elif max_sem1_end is not None and min_sem2_start is not None and max_sem1_end < thursday < min_sem2_start:
                    cells.append(CellInfo(
                        week_number=w.week_number,
                        period_type="holiday",
                        name="Зимові канікули"
                    ))
                else:
                    cells.append(CellInfo(
                        week_number=w.week_number,
                        period_type="theory",
                        name="Теоретичне навчання"
                    ))
            elif thursday.month in (7, 8):
                cells.append(CellInfo(
                    week_number=w.week_number,
                    period_type="holiday",
                    name="Літні канікули"
                ))
            else:
                cells.append(CellInfo(
                    week_number=w.week_number,
                    period_type="theory",
                    name="Теоретичне навчання"
                ))

        courses_map[course].append(GroupProcessInfo(
            group_id=group.id,
            group_name=group.name,
            cells=cells
        ))

    result_courses = []
    for c in sorted(courses_map.keys()):
        result_courses.append(CourseProcessInfo(
            course=c,
            groups=courses_map[c]
        ))

    return EducationalProcessMatrix(
        academic_year_start=academic_year_start,
        weeks=weeks,
        courses=result_courses,
        semesters=semesters_info,
    )


