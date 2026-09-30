from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import asyncio

from app.database import get_db
from app.models import Curriculum, TeacherConstraint, ScheduleDraft, ScheduleSlot
from app.schemas.constraint import ScheduleDraftResponse
from app.core.security import require_roles
from app.services import solver

router = APIRouter(prefix="/generator", tags=["Generator"])


@router.post("", response_model=ScheduleDraftResponse)
async def generate_schedule(
    max_time_in_seconds: int = 95,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    curriculums = (await db.scalars(select(Curriculum))).all()
    constraints = (await db.scalars(select(TeacherConstraint))).all()

    if not curriculums:
        raise HTTPException(status_code=400, detail="Немає навантаження для генерації.")

    # Вимоги до розкладу: Пн–Пт кожен день, щонайменше 3 пари, без вікон (1–2 пар бути не може).
    # Якщо навантаження цього не дозволяє — одразу пояснюємо, де саме проблема.
    problems = solver.precheck(curriculums, constraints)
    if problems:
        raise HTTPException(
            status_code=400,
            detail="Неможливо скласти розклад за заданими вимогами: " + "; ".join(problems),
        )

    # Розв'язуємо в окремому потоці, щоб не блокувати event loop
    result = await asyncio.to_thread(solver.solve, list(curriculums), list(constraints), max_time_in_seconds)
    print(f"Solver status: {result.status}, Objective: {result.objective}")

    if not result.ok:
        raise HTTPException(
            status_code=400,
            detail=(
                "Неможливо скласти розклад: пошук не знайшов варіанта, що задовольняє всі вимоги "
                "(3–4 пари щодня Пн–Пт, без вікон, збіги викладачів/потоків, закріплені пари). "
                "Перевірте обмеження викладачів і закріплені пари."
                if result.status == "INFEASIBLE"
                else f"Розклад не знайдено за {max_time_in_seconds} с (статус {result.status}). Збільште ліміт часу."
            ),
        )

    draft = ScheduleDraft(name=f"Генерація від {datetime.now().strftime('%d.%m %H:%M')}", status="DRAFT")
    db.add(draft)
    await db.flush()  # отримати draft.id

    db.add_all([
        ScheduleSlot(
            draft_id=draft.id,
            curriculum_id=c_id,
            day_of_week=(d % solver.DAYS) + 1,
            lesson_number=s + 1,
            week_type="numerator" if d < solver.DAYS else "denominator",
        )
        for (c_id, d, s) in result.assignments
    ])
    await db.commit()
    return draft
