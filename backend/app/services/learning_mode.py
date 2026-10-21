import json
import re
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group
from app.schemas import LearningModeConfig, LearningModeOverride
from app.services.settings import settings_service

LEARNING_MODE_KEY = "learning_mode"
OFFLINE = "offline"
ONLINE = "online"

_parsed_config_cache: tuple[str, LearningModeConfig] | None = None


def monday_of(value: date) -> date:
    return value - timedelta(days=value.weekday())


def infer_year_of_admission(group_name: str | None) -> int | None:
    if not group_name:
        return None
    cleaned = group_name.strip()
    # e.g. "КІ-24-1/9-85", "М3-26-92", "ТР-25-1/9-87"
    match_year = re.search(r"[-–](\d{2})(?:[-–/]|$)", cleaned)
    if match_year:
        yy = int(match_year.group(1))
        if 20 <= yy <= 35:
            return 2000 + yy
    # College group numbers: e.g. "85", "85 ДФКР", or suffix "-85"
    match_num = re.match(r"^(\d{2})(?:\s|$)", cleaned) or re.search(r"[-–](\d{2})$", cleaned)
    if match_num:
        num = int(match_num.group(1))
        if 75 <= num <= 80:
            return 2023
        if 81 <= num <= 86:
            return 2024
        if 87 <= num <= 91:
            return 2025
        if 92 <= num <= 99:
            return 2026
    return None


def course_for_date(year_of_admission: int, target: date) -> int | None:
    academic_start = target.year if target.month >= 8 else target.year - 1
    course = academic_start - year_of_admission + 1
    return course if 1 <= course <= 5 else None


def resolve_learning_mode_with_override(
    config: LearningModeConfig, course: int | None, target: date
) -> tuple[str | None, LearningModeOverride | None]:
    # 1. Course-specific overrides (newest first)
    if course is not None:
        for override in reversed(config.overrides):
            if override.start <= target <= override.end and override.courses and course in override.courses:
                return override.mode, override

    # 2. All-courses overrides (newest first) — works even if group course is unknown
    for override in reversed(config.overrides):
        if override.start <= target <= override.end and not override.courses:
            return override.mode, override

    if course is None or config.cycle_start is None:
        return None, None

    weeks_since_start = (monday_of(target) - monday_of(config.cycle_start)).days // 7
    if weeks_since_start < 0:
        return None, None

    phase = (weeks_since_start // config.weeks_per_phase) % 2
    first_phase_offline = course in config.first_phase_offline_courses
    offline_now = first_phase_offline if phase == 0 else not first_phase_offline
    return (OFFLINE if offline_now else ONLINE), None


def resolve_learning_mode(config: LearningModeConfig, course: int | None, target: date) -> str | None:
    mode, _ = resolve_learning_mode_with_override(config, course, target)
    return mode


async def get_learning_mode_config(db: AsyncSession) -> LearningModeConfig:
    global _parsed_config_cache
    raw = await settings_service.get(db, LEARNING_MODE_KEY)
    if not raw:
        return LearningModeConfig()
    if _parsed_config_cache is not None and _parsed_config_cache[0] == raw:
        return _parsed_config_cache[1]
    parsed = LearningModeConfig.model_validate(json.loads(raw))
    _parsed_config_cache = (raw, parsed)
    return parsed


async def save_learning_mode_config(db: AsyncSession, config: LearningModeConfig) -> None:
    global _parsed_config_cache
    raw = config.model_dump_json()
    _parsed_config_cache = (raw, config)
    await settings_service.set(db, LEARNING_MODE_KEY, raw)


async def resolve_group_learning_mode_detail(
    db: AsyncSession, group_id: int | None, target: date, group: Group | None = None
) -> tuple[str | None, LearningModeOverride | None]:
    if not group_id:
        return None, None
    if group is None:
        group = await db.get(Group, group_id)
    if group is None:
        return None, None
    config = await get_learning_mode_config(db)
    year_of_admission = group.year_of_admission or infer_year_of_admission(group.name)
    course = course_for_date(year_of_admission, target) if year_of_admission else None
    return resolve_learning_mode_with_override(config, course, target)


async def resolve_group_learning_mode(db: AsyncSession, group_id: int | None, target: date) -> str | None:
    mode, _ = await resolve_group_learning_mode_detail(db, group_id, target)
    return mode


async def resolve_group_week_learning_modes(
    db: AsyncSession, group_id: int | None, dates: list[date], group: Group | None = None
) -> dict[date, tuple[str | None, LearningModeOverride | None]]:
    if not group_id or not dates:
        return {d: (None, None) for d in dates}
    if group is None:
        group = await db.get(Group, group_id)
    if group is None:
        return {d: (None, None) for d in dates}
    config = await get_learning_mode_config(db)
    year_of_admission = group.year_of_admission or infer_year_of_admission(group.name)
    result: dict[date, tuple[str | None, LearningModeOverride | None]] = {}
    for d in dates:
        course = course_for_date(year_of_admission, d) if year_of_admission else None
        result[d] = resolve_learning_mode_with_override(config, course, d)
    return result
