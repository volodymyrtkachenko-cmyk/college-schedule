import asyncio
from app.database import async_session_factory
from app.models import Teacher, Group
from sqlalchemy import select

async def check():
    async with async_session_factory() as db:
        res = await db.execute(select(Teacher.id, Teacher.name))
        teachers = res.all()
        for tid, tname in teachers:
            if "Грабовчак" in tname:
                print(f"Teacher {tid}: {tname}")
        
        res = await db.execute(select(Group.id, Group.name))
        for gid, gname in res.all():
            if "31" in gname:
                print(f"Group {gid}: {gname}")

asyncio.run(check())
