from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from datetime import time
from app.database import get_db
from app.models import Schedule, Subject, Group
from app.core.security import require_roles

router = APIRouter()

denominator_data = {
    "Пн": [
      {"time": "9:00", "subject": "Дискретна математика", "lesson": 1},
      {"time": "10:40", "subject": "Комп'ютерна схемотехніка", "lesson": 2},
      {"time": "12:30", "subject": "Українська мова", "lesson": 3},
    ],
    "Вт": [
      {"time": "9:00", "subject": "Комп'ютерна електроніка", "lesson": 1},
      {"time": "10:40", "subject": "Фізична культура", "lesson": 2},
      {"time": "12:30", "subject": "Дискретна математика", "lesson": 3},
      {"time": "14:00", "subject": "Технології WEB-дизайну", "lesson": 4}
    ],
    "Ср": [
      {"time": "9:00", "subject": "Іноземна мова", "lesson": 1},
      {"time": "10:40", "subject": "Комп'ютерна схемотехніка", "lesson": 2},
      {"time": "12:30", "subject": "Технології WEB-дизайну", "lesson": 3},
    ],
    "Чт": [
      {"time": "9:00", "subject": "Технології WEB-дизайну", "lesson": 1},
      {"time": "10:40", "subject": "Основи філософських знань", "lesson": 2},
      {"time": "12:30", "subject": "Українська мова", "lesson": 3},
      {"time": "14:00", "subject": "Виховна година", "lesson": 4}
    ],
    "Пт": [
      {"time": "9:00", "subject": "Основи філософських знань", "lesson": 1},
      {"time": "10:40", "subject": "Комп'ютерна електроніка", "lesson": 2},
      {"time": "12:30", "subject": "Комп'ютерна схемотехніка", "lesson": 3},
    ]
}

day_map = {"Пн": 1, "Вт": 2, "Ср": 3, "Чт": 4, "Пт": 5}
time_map = {1: (time(9,0), time(10,20)), 2: (time(10,40), time(12,0)), 3: (time(12,30), time(13,50)), 4: (time(14,0), time(15,20))}

@router.get("/seed-denominator/{group_name}")
async def seed_denominator(group_name: str, db: AsyncSession = Depends(get_db)):
    # Find group
    group = await db.scalar(select(Group).where(Group.name == group_name))
    if not group:
        return {"error": f"Group {group_name} not found"}
        
    inserted = 0
    errors = []
    
    # Pre-fetch subjects
    subjects_db = await db.scalars(select(Subject))
    sub_map = {s.name.lower(): s.id for s in subjects_db}
    
    for day_str, lessons in denominator_data.items():
        day_val = day_map[day_str]
        for item in lessons:
            if item["subject"] is None:
                continue
            search_name = item["subject"].lower()
            sub_id = sub_map.get(search_name)
            
            # Fuzzy match fallback
            if not sub_id:
                for db_name, db_id in sub_map.items():
                    if search_name.split()[0][:4] in db_name:
                        sub_id = db_id
                        break
            
            if not sub_id:
                errors.append(f"Subject not found: {item['subject']}")
                continue
                
            l_num = item["lesson"]
            t_start, t_end = time_map[l_num]
            
            # Wipe any existing
            await db.execute(delete(Schedule).where(Schedule.group_id == group.id, Schedule.day_of_week == day_val, Schedule.lesson_number == l_num, Schedule.week_type == "denominator"))
            
            sch = Schedule(
                group_id=group.id,
                subject_id=sub_id,
                teacher_id=None,
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
    return {"message": "Success", "inserted": inserted, "errors": set(errors)}
