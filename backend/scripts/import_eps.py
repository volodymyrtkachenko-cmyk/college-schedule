import json
import sys
import os
from datetime import datetime

# Налаштовуємо PYTHONPATH, щоб можна було імпортувати app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from sqlalchemy import select
from app.database import SessionLocal
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

def main():
    json_path = os.path.join(os.path.dirname(__file__), "data", "educational_schedule_2026_2027.json")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    db: Session = SessionLocal()
    
    try:
        academic_year = data.get("academic_year")
        print(f"Імпорт Графіку освітнього процесу на {academic_year}...")
        
        for course_data in data.get("courses", []):
            course_num = course_data.get("course")
            for group_data in course_data.get("groups", []):
                group_name = group_data.get("group")
                
                # Знаходимо групу в БД
                stmt = select(Group).where(Group.name == group_name)
                group = db.execute(stmt).scalar_one_or_none()
                
                if not group:
                    print(f"Попередження: Групу {group_name} не знайдено в БД. Пропускаємо.")
                    continue
                
                # Оновлюємо рік вступу для групи, якщо його ще немає
                # (розраховуємо з урахуванням того, що зараз 2026 рік початку навчання)
                if group.year_of_admission is None:
                    # 2026 - (course_num - 1)
                    year_of_admission = 2026 - (course_num - 1)
                    group.year_of_admission = year_of_admission
                    print(f"Оновлено рік вступу для {group_name}: {year_of_admission}")
                
                periods = group_data.get("periods", [])
                for p in periods:
                    start_date = datetime.strptime(p["start"], "%Y-%m-%d").date()
                    end_date = datetime.strptime(p["end"], "%Y-%m-%d").date()
                    period_name = p["type"]
                    period_type = get_period_type(period_name)
                    
                    # Перевіряємо, чи такий період вже існує
                    stmt = select(SchedulePeriod).where(
                        SchedulePeriod.name == period_name,
                        SchedulePeriod.start_date == start_date,
                        SchedulePeriod.end_date == end_date,
                        SchedulePeriod.period_type == period_type
                    )
                    existing_period = db.execute(stmt).scalar_one_or_none()
                    
                    if not existing_period:
                        existing_period = SchedulePeriod(
                            name=period_name,
                            period_type=period_type,
                            start_date=start_date,
                            end_date=end_date
                        )
                        db.add(existing_period)
                        db.flush() # щоб отримати id
                    
                    # Додаємо групу до періоду, якщо її там ще немає
                    if group not in existing_period.groups:
                        existing_period.groups.append(group)
        
        db.commit()
        print("Імпорт успішно завершено!")
    except Exception as e:
        db.rollback()
        print(f"Помилка імпорту: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
