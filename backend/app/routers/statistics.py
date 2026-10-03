from app.core.time import today_local, now_local
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Group, Teacher
from app.schemas.statistics import StatisticsResponse
from app.services.settings import settings_service
from app.services.statistics import group_statistics, teacher_statistics

router = APIRouter(prefix="/statistics", tags=["Statistics"])


@router.get("/", response_model=StatisticsResponse)
async def statistics(
    group_id: int | None = Query(None, gt=0),
    teacher_id: int | None = Query(None, gt=0),
    db: AsyncSession = Depends(get_db),
):
    if (group_id is None) == (teacher_id is None):
        raise HTTPException(
            status_code=422,
            detail="Вкажіть рівно одну групу або одного викладача",
        )

    semester_start = await settings_service.get_semester_start(db)
    semester_end = await settings_service.get_configured_semester_end(db)
    today = today_local()
    through_date = min(today, semester_end) if semester_end is not None else today

    if group_id is not None:
        group = await db.scalar(
            select(Group).where(Group.id == group_id, Group.is_active.is_(True))
        )
        if group is None:
            raise HTTPException(status_code=404, detail="Групу не знайдено")
        data = await group_statistics(db, group, semester_start, through_date)
    else:
        teacher = await db.scalar(
            select(Teacher).where(Teacher.id == teacher_id, Teacher.is_active.is_(True))
        )
        if teacher is None:
            raise HTTPException(status_code=404, detail="Викладача не знайдено")
        data = await teacher_statistics(db, teacher, semester_start, through_date)

    return StatisticsResponse(**data)
