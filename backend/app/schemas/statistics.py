from datetime import date
from typing import Literal

from pydantic import BaseModel


class StatisticsEntry(BaseModel):
    id: int
    name: str
    completed_hours: int
    planned_hours: int | None = None
    progress_percent: float | None = None
    notes_count: int = 0
    cancelled_count: int = 0
    replaced_count: int = 0


class StatisticsResponse(BaseModel):
    mode: Literal["student", "teacher"]
    semester_start: date
    through_date: date
    total_hours: int
    planned_hours: int | None = None
    entries: list[StatisticsEntry]
