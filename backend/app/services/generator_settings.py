"""Глобальні налаштування генератора розкладу (зберігаються в таблиці settings).

Пріоритети критеріїв задаються рівнями 0..4, а не «сирими» вагами: рівень
множить базову вагу критерію, тож «Звичайний» (2) відтворює історичну
поведінку солвера, а адміністратор не мусить знати внутрішні масштаби штрафів.
"""
from __future__ import annotations

import json
import logging
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.settings import settings_service
from app.services.solver import SolverWeights

logger = logging.getLogger(__name__)

GENERATOR_SETTINGS_KEY = "generator_settings"

# Рівень пріоритету → множник базової ваги.
PRIORITY_MULTIPLIERS: tuple[float, ...] = (0.0, 0.25, 1.0, 4.0, 16.0)
PRIORITY_LEVEL_MIN = 0
PRIORITY_LEVEL_MAX = len(PRIORITY_MULTIPLIERS) - 1
DEFAULT_PRIORITY_LEVEL = 2

_BASE_WEIGHTS = SolverWeights()

def _level():
    return Field(default=DEFAULT_PRIORITY_LEVEL, ge=PRIORITY_LEVEL_MIN, le=PRIORITY_LEVEL_MAX)


class GeneratorPriorities(BaseModel):
    model_config = ConfigDict(extra="ignore")

    teacher_windows: int = _level()
    late_start: int = _level()
    three_consecutive_days: int = _level()
    subject_week_balance: int = _level()
    group_week_balance: int = _level()
    soft_teacher_constraints: int = _level()

    def to_weights(self) -> SolverWeights:
        return SolverWeights(**{
            name: int(round(getattr(_BASE_WEIGHTS, name) * PRIORITY_MULTIPLIERS[level]))
            for name, level in self.model_dump().items()
        })


class GeneratorSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    max_time_seconds: int = Field(default=600, ge=30, le=3600)
    optimization_time_seconds: int = Field(default=60, ge=0, le=1800)
    hint_mode: Literal["previous", "fresh"] = "previous"
    priorities: GeneratorPriorities = Field(default_factory=GeneratorPriorities)


class GeneratorPrioritiesOverride(BaseModel):
    teacher_windows: int | None = Field(default=None, ge=PRIORITY_LEVEL_MIN, le=PRIORITY_LEVEL_MAX)
    late_start: int | None = Field(default=None, ge=PRIORITY_LEVEL_MIN, le=PRIORITY_LEVEL_MAX)
    three_consecutive_days: int | None = Field(default=None, ge=PRIORITY_LEVEL_MIN, le=PRIORITY_LEVEL_MAX)
    subject_week_balance: int | None = Field(default=None, ge=PRIORITY_LEVEL_MIN, le=PRIORITY_LEVEL_MAX)
    group_week_balance: int | None = Field(default=None, ge=PRIORITY_LEVEL_MIN, le=PRIORITY_LEVEL_MAX)
    soft_teacher_constraints: int | None = Field(default=None, ge=PRIORITY_LEVEL_MIN, le=PRIORITY_LEVEL_MAX)


class GeneratorRunOptions(BaseModel):
    """Разові зміни налаштувань для одного запуску (не зберігаються)."""

    max_time_seconds: int | None = Field(default=None, ge=30, le=3600)
    optimization_time_seconds: int | None = Field(default=None, ge=0, le=1800)
    hint_mode: Literal["previous", "fresh"] | None = None
    priorities: GeneratorPrioritiesOverride | None = None


def apply_overrides(base: GeneratorSettings, overrides: GeneratorRunOptions | None) -> GeneratorSettings:
    if overrides is None:
        return base
    update = {
        key: value
        for key, value in overrides.model_dump(exclude={"priorities"}).items()
        if value is not None
    }
    if overrides.priorities is not None:
        priority_update = {
            key: value
            for key, value in overrides.priorities.model_dump().items()
            if value is not None
        }
        update["priorities"] = base.priorities.model_copy(update=priority_update)
    return base.model_copy(update=update)


async def get_generator_settings(db: AsyncSession) -> GeneratorSettings:
    raw = await settings_service.get(db, GENERATOR_SETTINGS_KEY)
    if not raw:
        return GeneratorSettings()
    try:
        return GeneratorSettings.model_validate(json.loads(raw))
    except (ValueError, ValidationError):
        logger.warning("Invalid generator settings in DB; falling back to defaults")
        return GeneratorSettings()


async def save_generator_settings(db: AsyncSession, value: GeneratorSettings) -> GeneratorSettings:
    await settings_service.set(db, GENERATOR_SETTINGS_KEY, value.model_dump_json())
    return value
