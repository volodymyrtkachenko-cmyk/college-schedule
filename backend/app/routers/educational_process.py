from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date, timedelta
from typing import List

from app.database import get_db
from app.models import Group, SchedulePeriod
from app.schemas.educational_process import EducationalProcessMatrix, WeekInfo, CourseProcessInfo, GroupProcessInfo, CellInfo

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

@router.get("", response_model=EducationalProcessMatrix)
async def get_matrix(
    academic_year_start: int = Query(..., description="Рік початку навчального року (наприклад, 2026)"),
    db: AsyncSession = Depends(get_db)
):
    start_date = date(academic_year_start, 9, 1)
    end_date = date(academic_year_start + 1, 8, 31)
    
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
    )
    all_periods = periods_result.scalars().all()
    
    group_periods_map = {g.id: [] for g in all_groups}
    for p in all_periods:
        for g in p.groups:
            if g.id in group_periods_map:
                group_periods_map[g.id].append(p)
                
    courses_map = {}
    
    for group in all_groups:
        if not group.year_of_admission:
            continue
            
        course = academic_year_start - group.year_of_admission + 1
        if not (1 <= course <= 5):
            continue
            
        if course not in courses_map:
            courses_map[course] = []
            
        cells = []
        g_periods = group_periods_map[group.id]
        
        for w in weeks:
            thursday = w.start_date + timedelta(days=3)
            active_period = None
            
            for p in g_periods:
                if p.start_date <= thursday <= p.end_date:
                    active_period = p
                    break
            
            if not active_period:
                for p in g_periods:
                    if p.start_date <= w.end_date and p.end_date >= w.start_date:
                        active_period = p
                        break
            
            if active_period:
                cells.append(CellInfo(
                    week_number=w.week_number,
                    period_type=active_period.period_type,
                    name=active_period.name
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
        courses=result_courses
    )


