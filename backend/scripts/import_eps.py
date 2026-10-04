import json
import sys
import os
import asyncio
from datetime import datetime

# Налаштовуємо PYTHONPATH, щоб можна було імпортувати app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.database import async_session_factory
from app.models.entities import Group, SchedulePeriod, schedule_period_groups

def get_period_type(ukr_type: str) -> str:
    mapping = {
        "Теоретичне навчання": "theory",
        "Екзаменаційна сесія": "session",
        "Канікули": "holiday",
        "Дипломне проєктування": "diploma",
        "Атестація": "attestation"
    }
    if ukr_type in mapping:
        return mapping[ukr_type]
    if "практика" in ukr_type.lower():
        return "practice"
    return "theory" # default fallback

async def async_main():
    json_path = os.path.join(os.path.dirname(__file__), "data", "educational_schedule_2026_2027.json")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    async with async_session_factory() as db:
        try:
            academic_year = data.get("academic_year")
            print(f"Імпорт Графіку освітнього процесу на {academic_year}...")
            
            for course_data in data.get("courses", []):
                course_num = course_data.get("course")
                for group_data in course_data.get("groups", []):
                    group_name = group_data.get("group")
                    
                    # Знаходимо групу в БД
                    stmt = select(Group).where(Group.name == group_name)
                    result = await db.execute(stmt)
                    group = result.scalar_one_or_none()
                    
                    if not group:
                        print(f"Попередження: Групу {group_name} не знайдено в БД. Пропускаємо.")
                        continue
                    
                    # Оновлюємо рік вступу для групи, якщо його ще немає
                    if group.year_of_admission is None:
                        year_of_admission = 2026 - (course_num - 1)
                        group.year_of_admission = year_of_admission
                        print(f"Оновлено рік вступу для {group_name}: {year_of_admission}")
                    
                    periods = group_data.get("periods", [])
                    
                    # Fetch existing groups for periods if needed, but here we can just append
                    # Since it's async, we need to load group relationships if we access them
                    # Or simpler: just execute insert into schedule_period_groups if not exists.
                    # Wait, if we create new SchedulePeriod, we can just set .groups = [group]
                    
                    for p in periods:
                        start_date = datetime.strptime(p["start"], "%Y-%m-%d").date()
                        end_date = datetime.strptime(p["end"], "%Y-%m-%d").date()
                        period_name = p["type"]
                        period_type = get_period_type(period_name)
                        
                        stmt = select(SchedulePeriod).where(
                            SchedulePeriod.name == period_name,
                            SchedulePeriod.start_date == start_date,
                            SchedulePeriod.end_date == end_date,
                            SchedulePeriod.period_type == period_type
                        )
                        result = await db.execute(stmt)
                        existing_period = result.scalar_one_or_none()
                        
                        if not existing_period:
                            existing_period = SchedulePeriod(
                                name=period_name,
                                period_type=period_type,
                                start_date=start_date,
                                end_date=end_date
                            )
                            db.add(existing_period)
                            await db.flush() # щоб отримати id
                            
                        # We need to link group to existing_period. 
                        # Because groups is a relationship, accessing it directly without loading will fail in async.
                        # We can do an insert into schedule_period_groups directly.
                        from sqlalchemy import insert
                        
                        check_stmt = select(schedule_period_groups).where(
                            schedule_period_groups.c.period_id == existing_period.id,
                            schedule_period_groups.c.group_id == group.id
                        )
                        link_exists = (await db.execute(check_stmt)).first()
                        if not link_exists:
                            await db.execute(insert(schedule_period_groups).values(period_id=existing_period.id, group_id=group.id))

            await db.commit()
            print("Імпорт успішно завершено!")
        except Exception as e:
            await db.rollback()
            print(f"Помилка імпорту: {e}")

def main():
    asyncio.run(async_main())

if __name__ == "__main__":
    main()
