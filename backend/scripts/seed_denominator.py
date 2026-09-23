import json
import os
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from datetime import time
from app.database import get_db
from app.models import Schedule, Subject, Group, Teacher
from app.core.security import require_roles

router = APIRouter()

day_map = {"Понеділок": 1, "Вівторок": 2, "Середа": 3, "Четвер": 4, "П'ятниця": 5}
time_map = {
    "7:30-8:50": (0, time(7,30), time(8,50)),
    "9:00-10:20": (1, time(9,0), time(10,20)),
    "10:40-12:00": (2, time(10,40), time(12,0)),
    "12:30-13:50": (3, time(12,30), time(13,50)),
    "14:00-15:20": (4, time(14,0), time(15,20)),
    "15:30-16:50": (5, time(15,30), time(16,50)),
}

@router.get("/seed-denominator-bulk")
async def seed_denominator_bulk(db: AsyncSession = Depends(get_db)):
    json_path = os.path.join(os.path.dirname(__file__), "..", "..", "denominator_full.json")
    if not os.path.exists(json_path):
        return {"error": "denominator_full.json not found"}
        
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    inserted = 0
    errors = []
    
    # Pre-fetch objects
    groups_db = await db.scalars(select(Group))
    group_map = {g.name: g.id for g in groups_db}
    
    subjects_db = await db.scalars(select(Subject))
    sub_map = {s.name.lower(): s.id for s in subjects_db}
    
    teachers_db = await db.scalars(select(Teacher))
    teacher_map = {t.name: t.id for t in teachers_db}
    
    for g_name, schedule_days in data["groups"].items():
        g_id = group_map.get(g_name)
        if not g_id:
            errors.append(f"Group {g_name} not found in DB")
            continue
            
        for day_str, lessons in schedule_days.items():
            day_val = day_map.get(day_str)
            if not day_val:
                continue
                
            for item in lessons:
                if not item.get("subject"):
                    continue
                    
                # Subject matching
                search_sub = item["subject"].replace("*", "").strip()
                sub_id = sub_map.get(search_sub.lower())
                if not sub_id:
                    for db_name, db_id in sub_map.items():
                        if search_sub.lower().split()[0][:5] in db_name.lower():
                            sub_id = db_id
                            break
                if not sub_id:
                    errors.append(f"[{g_name}] Subject not found: {search_sub}")
                    continue
                    
                # Time matching
                time_str = item["time"]
                t_tuple = time_map.get(time_str)
                if not t_tuple:
                    errors.append(f"[{g_name}] Time format unknown: {time_str}")
                    continue
                l_num, t_start, t_end = t_tuple
                
                # Teacher matching
                teacher_str = item.get("teacher")
                t_id1, t_id2 = None, None
                if teacher_str:
                    t_names = [x.strip() for x in teacher_str.split(",")]
                    t_id1 = teacher_map.get(t_names[0])
                    if not t_id1:
                         errors.append(f"[{g_name}] Teacher not found: {t_names[0]}")
                    if len(t_names) > 1:
                        t_id2 = teacher_map.get(t_names[1])
                        if not t_id2:
                             errors.append(f"[{g_name}] Second teacher not found: {t_names[1]}")
                             
                # Wipe any existing for this specific slot
                await db.execute(delete(Schedule).where(Schedule.group_id == g_id, Schedule.day_of_week == day_val, Schedule.lesson_number == l_num, Schedule.week_type == "denominator"))
                
                sch = Schedule(
                    group_id=g_id,
                    subject_id=sub_id,
                    teacher_id=t_id1,
                    second_teacher_id=t_id2,
                    day_of_week=day_val,
                    lesson_number=l_num,
                    week_type="denominator",
                    start_time=t_start,
                    end_time=t_end,
                    is_active=True
                )
                db.add(sch)
                inserted += 1
                
    await db.commit()
    return {"message": "Success", "inserted": inserted, "errors": list(set(errors))}
