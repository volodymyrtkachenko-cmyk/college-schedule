from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_roles
from app.database import get_db
from app.schemas import SemesterDatesSetting, SemesterDatesUpdate, SemesterStartSetting
from app.services.settings import SEMESTER_START_KEY, settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/semester-start", response_model=SemesterStartSetting)
async def get_semester_start(db: AsyncSession = Depends(get_db)):
    try:
        value = await settings_service.get_semester_start(db)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return SemesterStartSetting(value=value)


@router.put("/semester-start", response_model=SemesterStartSetting)
async def update_semester_start(
    payload: SemesterStartSetting,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin")),
):
    _, semester_end = await settings_service.get_saved_semester_dates(db)
    if semester_end is not None and payload.value > semester_end:
        raise HTTPException(
            status_code=422,
            detail="semester_start must not be after semester_end",
        )
    value = payload.value
    await settings_service.set(db, SEMESTER_START_KEY, value.isoformat())
    return SemesterStartSetting(value=value)


@router.get("/semester-dates", response_model=SemesterDatesSetting)
async def get_semester_dates(db: AsyncSession = Depends(get_db)):
    try:
        start, end = await settings_service.get_saved_semester_dates(db)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return SemesterDatesSetting(
        semester_start=start,
        semester_end=end,
        configured=start is not None and end is not None,
    )


@router.put("/semester-dates", response_model=SemesterDatesSetting)
async def update_semester_dates(
    payload: SemesterDatesUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin")),
):
    await settings_service.set_semester_dates(
        db, payload.semester_start, payload.semester_end
    )
    return SemesterDatesSetting(
        semester_start=payload.semester_start,
        semester_end=payload.semester_end,
        configured=True,
    )
