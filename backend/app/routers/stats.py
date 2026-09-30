from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from collections import defaultdict

from app.database import get_db
from app.models import Schedule

router = APIRouter(prefix="/stats", tags=["stats"])

@router.get("")
async def get_stats(db: AsyncSession = Depends(get_db)):
    query = select(Schedule).options(
        selectinload(Schedule.group),
        selectinload(Schedule.teacher),
        selectinload(Schedule.second_teacher),
        selectinload(Schedule.subject)
    ).where(Schedule.is_active.is_(True))
    
    schedules = (await db.scalars(query)).all()
    
    group_stats = defaultdict(lambda: {"total": 0, "numerator": 0, "denominator": 0, "subjects": defaultdict(int), "name": ""})
    teacher_stats = defaultdict(lambda: {"total": 0, "numerator": 0, "denominator": 0, "subjects": defaultdict(int), "name": ""})
    
    for s in schedules:
        num = 1 if s.week_type in ("numerator", "both") else 0
        den = 1 if s.week_type in ("denominator", "both") else 0
        total = num + den
        
        g_name = s.group.name if s.group else "Невідома група"
        group_stats[g_name]["name"] = g_name
        group_stats[g_name]["total"] += total
        group_stats[g_name]["numerator"] += num
        group_stats[g_name]["denominator"] += den
        group_stats[g_name]["subjects"][s.subject.name] += total
        
        if s.teacher:
            teacher_stats[s.teacher.name]["name"] = s.teacher.name
            teacher_stats[s.teacher.name]["total"] += total
            teacher_stats[s.teacher.name]["numerator"] += num
            teacher_stats[s.teacher.name]["denominator"] += den
            teacher_stats[s.teacher.name]["subjects"][s.subject.name] += total
            
        if s.second_teacher:
            teacher_stats[s.second_teacher.name]["name"] = s.second_teacher.name
            teacher_stats[s.second_teacher.name]["total"] += total
            teacher_stats[s.second_teacher.name]["numerator"] += num
            teacher_stats[s.second_teacher.name]["denominator"] += den
            teacher_stats[s.second_teacher.name]["subjects"][s.subject.name] += total

    # Convert defaultdicts to regular lists of dicts
    format_stats = lambda stats: [
        {
            "name": data["name"],
            "total": data["total"],
            "numerator": data["numerator"],
            "denominator": data["denominator"],
            "subjects": [{"name": k, "count": v} for k, v in sorted(data["subjects"].items())]
        }
        for data in sorted(stats.values(), key=lambda x: x["name"])
    ]

    return {
        "groups": format_stats(group_stats),
        "teachers": format_stats(teacher_stats)
    }
