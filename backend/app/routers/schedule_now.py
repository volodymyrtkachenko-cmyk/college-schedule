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

    shortened_dates = await settings_service.get_shortened_dates_set(db)
    current_lesson = None

    if today_date in shortened_dates:
        from datetime import time as _time_cls
        shortened_bells = [
            (1, _time_cls(9, 0), _time_cls(9, 50)),
            (2, _time_cls(10, 0), _time_cls(10, 50)),
            (3, _time_cls(11, 0), _time_cls(11, 50)),
            (4, _time_cls(12, 0), _time_cls(12, 50)),
            (5, _time_cls(13, 0), _time_cls(13, 50)),
        ]
        for l_num, s_t, e_t in shortened_bells:
            if s_t <= current_time <= e_t:
                current_lesson = l_num
                break
    else:
        bells = (await db.scalars(select(BellSchedule).where(BellSchedule.is_active == True).order_by(BellSchedule.lesson_number))).all()
        for bell in bells:
            if bell.start_time <= current_time <= bell.end_time:
                current_lesson = bell.lesson_number
                break
            
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(today_date, semester_start)
    
    lessons = await build_projection(db, target_date=today_date)
    
    active_bells = shortened_bells if today_date in shortened_dates else [(b.lesson_number, b.start_time, b.end_time) for b in bells]
    is_school_day = today_date.isoweekday() <= 5
    is_study_hours = False
    if active_bells and is_school_day:
        first_start = active_bells[0][1]
        last_end = active_bells[-1][2]
        is_study_hours = first_start <= current_time <= last_end

    is_break = bool(is_study_hours and current_lesson is None)
    if current_lesson:
        active_lessons = [L for L in lessons if L.lesson_number == current_lesson]
    else:
        active_lessons = []

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
        "is_break": is_break,
        "is_outside_hours": not is_study_hours,
        "active_classes": response_data
    }
