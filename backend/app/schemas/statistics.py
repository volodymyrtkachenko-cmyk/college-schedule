from datetime import date
from typing import Literal

from pydantic import BaseModel


class StatisticsEntry(BaseModel):
    id: int
    name: str
    completed_hours: int
    planned_hours: int | None = None
    progress_percent: float | None = None


class StatisticsResponse(BaseModel):
    mode: Literal["student", "teacher"]
    semester_start: date
    through_date: date
    total_hours: int
    planned_hours: int | None = None
    entries: list[StatisticsEntry]
