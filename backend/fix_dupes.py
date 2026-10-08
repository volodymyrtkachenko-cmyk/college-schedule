import asyncio
from app.database import async_session_factory
from app.models import Schedule
from sqlalchemy import select, delete

async def fix():
    async with async_session_factory() as db:
        res = await db.execute(select(Schedule))
        schedules = res.scalars().all()
        
        seen = set()
        dupes = []
        for s in schedules:
            # unique identifier for a lesson cell in a given version
            key = (s.version_id, s.group_id, s.day_of_week, s.lesson_number, s.week_type, s.subject_id, s.teacher_id)
            if key in seen:
                dupes.append(s.id)
            else:
                seen.add(key)
        
        if dupes:
            print(f"Found {len(dupes)} duplicate Schedule rows. Deleting...")
            await db.execute(delete(Schedule).where(Schedule.id.in_(dupes)))
            await db.commit()
            print("Done.")
        else:
            print("No duplicate Schedule rows found.")

asyncio.run(fix())
