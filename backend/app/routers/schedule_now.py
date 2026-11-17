from app.core.time import today_local, now_local
from datetime import datetime, time as _time_cls
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any

from app.database import get_db
from app.services.bells import get_bell_times
from app.services.classroom_access import sanitize_room_for_guest
from app.services.projection import build_projection
from app.services.settings import settings_service
from app.services.week import get_week_type

router = APIRouter(prefix="/now", tags=["schedule"])

@router.get("", response_model=Dict[str, Any])
async def get_schedule_now(db: AsyncSession = Depends(get_db)):
    now = now_local()
    today_date = now.date()
    current_time = now.time()

    shortened_dates = await settings_service.get_shortened_dates_set(db)
    current_lesson = None

    if today_date in shortened_dates:
        active_bells = [
            (1, _time_cls(9, 0), _time_cls(9, 50)),
            (2, _time_cls(10, 0), _time_cls(10, 50)),
            (3, _time_cls(11, 0), _time_cls(11, 50)),
            (4, _time_cls(12, 0), _time_cls(12, 50)),
        ]
    else:
        bell_map = await get_bell_times(db)
        active_bells = []
        for l_num, (start_str, end_str) in sorted(bell_map.items()):
            sh, sm = map(int, start_str.split(":", 1))
            eh, em = map(int, end_str.split(":", 1))
            active_bells.append((l_num, _time_cls(sh, sm), _time_cls(eh, em)))

    for l_num, s_t, e_t in active_bells:
        if s_t <= current_time <= e_t:
            current_lesson = l_num
            break
            
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(today_date, semester_start)
    
    lessons = await build_projection(db, target_date=today_date)
    
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
        sanitized_room, _ = sanitize_room_for_guest(ln.room)
        room_val = sanitized_room or "-"
            
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
