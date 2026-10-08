import os
os.environ["DATABASE_URL"] = "postgresql+psycopg://college_schedule:college_schedule_dev@localhost:5432/college_schedule"
import asyncio
from sqlalchemy import select
from app.database import async_session_factory
from app.models import Teacher

async def check():
    async with async_session_factory() as db:
        res = await db.execute(select(Teacher.name, Teacher.id))
        for t_name, t_id in res.all():
            if "Грабовчак" in t_name:
                print(f"ID {t_id}: {t_name}")

asyncio.run(check())
