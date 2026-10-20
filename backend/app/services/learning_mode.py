import json
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group
from app.schemas import LearningModeConfig
from app.services.settings import settings_service

LEARNING_MODE_KEY = "learning_mode"
OFFLINE = "offline"
ONLINE = "online"


def monday_of(value: date) -> date:
    return value - timedelta(days=value.weekday())


def course_for_date(year_of_admission: int, target: date) -> int | None:
    academic_start = target.year if target.month >= 8 else target.year - 1
    course = academic_start - year_of_admission + 1
    return course if 1 <= course <= 5 else None


def resolve_learning_mode(config: LearningModeConfig, course: int | None, target: date) -> str | None:
    if course is None:
        return None

    for override in config.overrides:
        if override.start <= target <= override.end and (not override.courses or course in override.courses):
            return override.mode

    if config.cycle_start is None:
        return None

    weeks_since_start = (monday_of(target) - monday_of(config.cycle_start)).days // 7
    if weeks_since_start < 0:
        return None

    phase = (weeks_since_start // config.weeks_per_phase) % 2
    first_phase_offline = course in config.first_phase_offline_courses
    offline_now = first_phase_offline if phase == 0 else not first_phase_offline
    return OFFLINE if offline_now else ONLINE


async def get_learning_mode_config(db: AsyncSession) -> LearningModeConfig:
    raw = await settings_service.get(db, LEARNING_MODE_KEY)
    if not raw:
        return LearningModeConfig()
    return LearningModeConfig.model_validate(json.loads(raw))


async def save_learning_mode_config(db: AsyncSession, config: LearningModeConfig) -> None:
    await settings_service.set(db, LEARNING_MODE_KEY, config.model_dump_json())


async def resolve_group_learning_mode(db: AsyncSession, group_id: int | None, target: date) -> str | None:
    if not group_id:
        return None
    group = await db.get(Group, group_id)
    if group is None or not group.year_of_admission:
        return None
    config = await get_learning_mode_config(db)
    course = course_for_date(group.year_of_admission, target)
    return resolve_learning_mode(config, course, target)
