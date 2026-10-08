import asyncio
import logging
from sqlalchemy import select, delete
from app.database import async_session_factory
from app.models import Schedule

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def cleanup_duplicates():
    async with async_session_factory() as db:
        res = await db.execute(select(Schedule))
        schedules = res.scalars().all()
        
        seen = set()
        dupes_to_delete = []
        
        for s in schedules:
            if s.stream_id:
                continue
                
            key = (
                s.version_id, 
                s.group_id, 
                s.day_of_week, 
                s.lesson_number, 
                s.week_type, 
                s.subject_id, 
                s.teacher_id, 
                s.room_override
            )
            if key in seen:
                dupes_to_delete.append(s.id)
            else:
                seen.add(key)
                
        if not dupes_to_delete:
            logger.info("Дублікатів не знайдено.")
            return

        logger.info(f"Знайдено {len(dupes_to_delete)} дублікатів. Видаляємо...")
        chunk_size = 100
        for i in range(0, len(dupes_to_delete), chunk_size):
            chunk = dupes_to_delete[i:i + chunk_size]
            await db.execute(delete(Schedule).where(Schedule.id.in_(chunk)))
            
        await db.commit()
        logger.info("Успішно видалено всі дублікати!")

if __name__ == "__main__":
    asyncio.run(cleanup_duplicates())
