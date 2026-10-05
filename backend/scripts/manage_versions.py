import sys
import os
import asyncio
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.database import async_session_factory
from app.models.entities import ScheduleVersion

async def list_versions(db):
    res = await db.execute(select(ScheduleVersion).order_by(ScheduleVersion.valid_from))
    versions = res.scalars().all()
    if not versions:
        print("Версій не знайдено.")
        return
    
    print("\n--- Версії розкладу ---")
    for v in versions:
        status = "Активна" if v.is_active else "Неактивна"
        print(f"ID: {v.id} | Назва: {v.name} | З: {v.valid_from} По: {v.valid_until} | Статус: {status}")
    print("-----------------------\n")

async def create_version(db):
    name = input("Введіть назву версії (напр. 'Семестр 1, 2026-2027'): ").strip()
    valid_from_str = input("Діє З (формат YYYY-MM-DD): ").strip()
    valid_until_str = input("Діє ПО (формат YYYY-MM-DD): ").strip()
    
    try:
        valid_from = datetime.strptime(valid_from_str, "%Y-%m-%d").date()
        valid_until = datetime.strptime(valid_until_str, "%Y-%m-%d").date()
    except ValueError:
        print("Помилка формату дати!")
        return

    v = ScheduleVersion(name=name, valid_from=valid_from, valid_until=valid_until, is_active=True)
    db.add(v)
    await db.commit()
    print(f"Версію '{name}' успішно створено!")

async def toggle_version(db):
    v_id_str = input("Введіть ID версії для зміни статусу (або пустий рядок для скасування): ").strip()
    if not v_id_str.isdigit():
        return
    
    v = await db.get(ScheduleVersion, int(v_id_str))
    if not v:
        print("Версію не знайдено.")
        return
        
    v.is_active = not v.is_active
    await db.commit()
    status = "Активна" if v.is_active else "Неактивна"
    print(f"Статус версії '{v.name}' змінено на: {status}")

async def async_main():
    async with async_session_factory() as db:
        while True:
            print("Оберіть дію:")
            print("1. Показати всі версії")
            print("2. Створити нову версію")
            print("3. Змінити активність версії")
            print("0. Вихід")
            
            choice = input("Ваш вибір: ").strip()
            
            if choice == "1":
                await list_versions(db)
            elif choice == "2":
                await create_version(db)
            elif choice == "3":
                await toggle_version(db)
            elif choice == "0":
                break
            else:
                print("Невідомий вибір.")

def main():
    asyncio.run(async_main())

if __name__ == "__main__":
    main()
