from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
import asyncio

from app.database import get_db
from app.models import Curriculum, TeacherConstraint, ScheduleDraft, ScheduleSlot
from app.schemas.constraint import ScheduleDraftResponse
from app.core.security import require_roles
from app.services import solver

router = APIRouter(prefix="/generator", tags=["Generator"])


@router.post("", response_model=ScheduleDraftResponse)
async def generate_schedule(
    max_time_in_seconds: int = Query(default=95, gt=0),
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    curriculums = (
        await db.scalars(
            select(Curriculum).options(
                joinedload(Curriculum.group),
                joinedload(Curriculum.subject),
            )
        )
    ).all()
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
    if not result.ok:
        if result.status == "INFEASIBLE":
            detail = (
                "Неможливо скласти розклад: обмеження розкладу несумісні "
                "(3–4 пари щодня Пн–Пт, без вікон, доступність викладачів, потоки та закріплені пари). "
                "Перевірте закріплені пари й обмеження викладачів."
            )
        elif result.status == "TIMEOUT":
            detail = (
                f"Пошук не знайшов розклад за {max_time_in_seconds} с і не зміг довести неможливість. "
                "Збільште ліміт часу або послабте обмеження."
            )
        else:
            detail = f"Помилка моделі генератора розкладу: {result.status}."
        raise HTTPException(
            status_code=400,
            detail=detail,
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
