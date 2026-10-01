from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any

from app.database import get_db
from app.models import BellSchedule
from app.services.schedule import fetch_schedule, week_types_overlap
from app.core.security import get_current_user

router = APIRouter(prefix="/now", tags=["schedule"])

@router.get("", response_model=Dict[str, Any])
async def get_schedule_now(db: AsyncSession = Depends(get_db)):
    now = datetime.now()
    today_date = now.date()
    current_time = now.time()

    bells = (await db.scalars(select(BellSchedule).where(BellSchedule.is_active == True).order_by(BellSchedule.lesson_number))).all()
    
    current_lesson = None
    for bell in bells:
        if bell.start_time <= current_time <= bell.end_time:
            current_lesson = bell.lesson_number
            break
            
    week_type, lessons = await fetch_schedule(db, target_date=today_date)
    active_lessons = [L for L in lessons if week_types_overlap(L.week_type, week_type)]
    
    if current_lesson:
        active_lessons = [L for L in active_lessons if L.lesson_number == current_lesson]

    response_data = []
    for ln in active_lessons:
        ovr = next((o for o in getattr(ln, "overrides", []) if o.date == today_date), None)
        if ovr and ovr.cancelled:
            continue
            
        grp = ln.group.name if ln.group else "Unknown"
        subj_name = (ovr.subject.name if ovr and ovr.subject else (ln.subject.name if ln.subject else "-"))
        t1_name = (ovr.teacher.name if ovr and ovr.teacher else (ln.teacher.name if ln.teacher else "-"))
        
        room_val = "-"
        if ovr and ovr.room:
            room_val = ovr.room
        elif ln.room_override:
            room_val = ln.room_override
        elif ovr and ovr.teacher and ovr.teacher.room:
            room_val = ovr.teacher.room
        elif not ovr and ln.teacher and ln.teacher.room:
            room_val = ln.teacher.room
            
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
