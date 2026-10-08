from app.core.time import today_local, now_local
from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any

from app.database import get_db
from app.models import BellSchedule
from app.services.projection import build_projection
from app.services.settings import settings_service
from app.services.week import get_week_type
from app.core.security import get_current_user

router = APIRouter(prefix="/now", tags=["schedule"])

@router.get("", response_model=Dict[str, Any])
async def get_schedule_now(db: AsyncSession = Depends(get_db)):
    now = now_local()
    today_date = now.date()
    current_time = now.time()

    bells = (await db.scalars(select(BellSchedule).where(BellSchedule.is_active == True).order_by(BellSchedule.lesson_number))).all()
    
    current_lesson = None
    for bell in bells:
        if bell.start_time <= current_time <= bell.end_time:
            current_lesson = bell.lesson_number
            break
            
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(today_date, semester_start)
    
    lessons = await build_projection(db, target_date=today_date)
    
    if current_lesson:
        active_lessons = [L for L in lessons if L.lesson_number == current_lesson]
    else:
        active_lessons = lessons

    response_data = []
    for ln in active_lessons:
        grp = ln.group_name or "Unknown"
        subj_name = ln.subject_name or "-"
        t1_name = ln.teacher_name or "-"
        room_val = ln.room or "-"
            
        response_data.append({
            "lesson_number": ln.lesson_number,
            "group": grp,
            "teacher": t1_name,
            "room": room_val,
            "subject": subj_name
        })

    response_data.sort(key=lambda x: (x["lesson_number"], x["group"]))
    
    return {
        "timestamp": now.isoformat(),
        "week_type": week_type,
        "current_lesson_number": current_lesson,
        "is_break": current_lesson is None,
        "active_classes": response_data
    }
