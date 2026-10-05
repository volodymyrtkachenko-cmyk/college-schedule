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

def normalize_name(name: str) -> str:
    # Заміна англійських літер на українські (часта опечатка)
    replacements = {
        'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'I': 'І', 
        'M': 'М', 'O': 'О', 'P': 'Р', 'T': 'Т', 'X': 'Х',
        'a': 'а', 'c': 'с', 'e': 'е', 'i': 'і', 'o': 'о', 'p': 'р', 'x': 'х'
    }
    res = name
    for eng, ukr in replacements.items():
        res = res.replace(eng, ukr)
    return res

async def async_main():
    default_path = os.path.join(os.path.dirname(__file__), "data", "educational_schedule_2026_2027.json")
    if (sys.stdin.isatty() and not os.environ.get('NON_INTERACTIVE') and not os.environ.get('FLY_APP_NAME')):
        user_path = input(f"Введіть шлях до JSON файлу [{default_path}]: ").strip()
        json_path = user_path if user_path else default_path
    else:
        json_path = default_path
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    async with async_session_factory() as db:
        try:
            academic_year = data.get("academic_year")
            print(f"Імпорт Графіку освітнього процесу на {academic_year}...")
            
            # Отримуємо всі групи заздалегідь для fuzzy-пошуку
            all_groups_res = await db.execute(select(Group))
            all_groups = all_groups_res.scalars().all()
            group_dict = {normalize_name(g.name): g for g in all_groups}
            group_dict_exact = {g.name: g for g in all_groups}
            
            for course_data in data.get("courses", []):
                course_num = course_data.get("course")
                for group_data in course_data.get("groups", []):
                    group_name = group_data.get("group")
                    norm_name = normalize_name(group_name)
                    
                    group = group_dict.get(norm_name)
                    if not group:
                        # Спробуємо останній суфікс як назву (напр. "ТР-25-1/9-87" -> "87")
                        suffix = group_name.split('-')[-1]
                        if suffix in group_dict_exact:
                            group = group_dict_exact[suffix]
                    
                    if not group:
                        print(f"Попередження: Групу {group_name} не знайдено в БД (нормалізовано як {norm_name}).")
                        if (sys.stdin.isatty() and not os.environ.get('NON_INTERACTIVE') and not os.environ.get('FLY_APP_NAME')):
                            action = input("Пропустити (п) чи ввести правильну назву вручну (в)? [п/в]: ").strip().lower()
                            if action == 'в':
                                new_name = input("Введіть точну назву групи з БД: ").strip()
                                group = group_dict_exact.get(new_name)
                                if not group:
                                    print(f"Групу {new_name} також не знайдено. Пропускаємо.")
                                    continue
                            else:
                                print("Пропускаємо.")
                                continue
                        else:
                            print("Неінтерактивний режим: пропускаємо.")
                            continue
                    
                    if group.year_of_admission is None:
                        year_of_admission = 2026 - (course_num - 1)
                        group.year_of_admission = year_of_admission
                        print(f"Оновлено рік вступу для {group.name}: {year_of_admission}")
                    
                    periods = group_data.get("periods", [])
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
