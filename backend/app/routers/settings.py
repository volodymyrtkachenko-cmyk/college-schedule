from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_roles
from app.database import get_db
from app.schemas import SemesterStartSetting
from app.services.settings import SEMESTER_START_KEY, settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


def _validate_semester_start(value):
    if value.isoweekday() != 1:
        raise HTTPException(
            status_code=422,
            detail="semester_start must be a Monday",
        )
    return value


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
    value = _validate_semester_start(payload.value)
    await settings_service.set(db, SEMESTER_START_KEY, value.isoformat())
    return SemesterStartSetting(value=value)
