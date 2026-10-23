from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel, Field
from app.core.security import require_roles
from app.database import get_db
from app.schemas import LearningModeConfig, SemesterDatesSetting, SemesterDatesUpdate, SemesterStartSetting
from app.services.learning_mode import get_learning_mode_config, save_learning_mode_config
from app.services.settings import SEMESTER_START_KEY, TEACHER_PIN_KEY, settings_service

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
            detail="Дата початку семестру не може бути пізніше за дату завершення",
        )
    value = payload.value
    await settings_service.set(db, SEMESTER_START_KEY, value.isoformat())
    return SemesterStartSetting(value=value)


@router.get("/learning-mode", response_model=LearningModeConfig)
async def get_learning_mode(db: AsyncSession = Depends(get_db)):
    return await get_learning_mode_config(db)


@router.put("/learning-mode", response_model=LearningModeConfig)
async def update_learning_mode(
    payload: LearningModeConfig,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin")),
):
    await save_learning_mode_config(db, payload)
    return payload


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


class VerifyTeacherPinRequest(BaseModel):
    pin: str


class VerifyTeacherPinResponse(BaseModel):
    valid: bool


class TeacherPinSetting(BaseModel):
    pin: str = Field(min_length=1, max_length=50)


@router.post("/verify-teacher-pin", response_model=VerifyTeacherPinResponse)
async def verify_teacher_pin(
    payload: VerifyTeacherPinRequest,
    db: AsyncSession = Depends(get_db),
):
    expected = await settings_service.get_teacher_pin(db)
    is_valid = bool(payload.pin and payload.pin.strip() == expected.strip())
    return VerifyTeacherPinResponse(valid=is_valid)


@router.get("/teacher-pin", response_model=TeacherPinSetting)
async def get_teacher_pin_setting(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin")),
):
    pin = await settings_service.get_teacher_pin(db)
    return TeacherPinSetting(pin=pin)


@router.put("/teacher-pin", response_model=TeacherPinSetting)
async def update_teacher_pin_setting(
    payload: TeacherPinSetting,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin")),
):
    await settings_service.set(db, TEACHER_PIN_KEY, payload.pin.strip())
    return payload
