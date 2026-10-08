import os
os.environ["DATABASE_URL"] = "postgresql+psycopg://college_schedule:college_schedule_dev@localhost:5432/college_schedule"
import asyncio
from sqlalchemy import select
from app.database import async_session_factory
from app.models import Curriculum, Group, Subject

async def check():
    async with async_session_factory() as db:
        res = await db.execute(
            select(Curriculum, Group.name, Subject.name)
            .join(Group, Curriculum.group_id == Group.id)
            .join(Subject, Curriculum.subject_id == Subject.id)
        )
        currs = res.all()
        
        counts = {}
        for c, g_name, subj_name in currs:
            key = (g_name, subj_name)
            counts[key] = counts.get(key, 0) + 1
            
        print("Curriculum counts by group/subject:")
        for k, v in counts.items():
            if v > 1:
                print(k, "count:", v)

asyncio.run(check())
