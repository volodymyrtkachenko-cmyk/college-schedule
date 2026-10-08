import os
os.environ["DATABASE_URL"] = "postgresql+psycopg://college_schedule:college_schedule_dev@localhost:5432/college_schedule"

import asyncio
from sqlalchemy import select
from app.database import async_session_factory
from app.models import Schedule, Group, Subject, Teacher

async def check():
    async with async_session_factory() as db:
        res = await db.execute(
            select(Schedule, Group.name, Subject.name, Teacher.name)
            .join(Group, Schedule.group_id == Group.id)
            .join(Subject, Schedule.subject_id == Subject.id)
            .join(Teacher, Schedule.teacher_id == Teacher.id)
        )
        schedules = res.all()
        
        counts = {}
        for s, g_name, subj_name, t_name in schedules:
            key = (g_name, s.day_of_week, s.lesson_number, s.week_type, subj_name, t_name)
            counts[key] = counts.get(key, 0) + 1
            
        dupes = {k: v for k, v in counts.items() if v > 1}
        print("Duplicates by (group_name, day_of_week, lesson_number, week_type, subject_name):")
        for k, v in dupes.items():
            print(k, "count:", v)

asyncio.run(check())
