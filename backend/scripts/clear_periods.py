import asyncio
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.database import async_session_factory
from sqlalchemy import delete
from app.models.entities import SchedulePeriod

async def run():
    async with async_session_factory() as db:
        await db.execute(delete(SchedulePeriod))
        await db.commit()
        print("Всі періоди розкладу успішно видалені з бази даних.")

if __name__ == "__main__":
    asyncio.run(run())
