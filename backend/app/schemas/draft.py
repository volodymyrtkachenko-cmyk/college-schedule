from pydantic import BaseModel, ConfigDict, model_validator
from datetime import datetime
from typing import Any, Optional, Literal
from .curriculum import CurriculumResponse

class ScheduleDraftResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    draft_type: Literal["import", "generated"]
    status: str
    created_at: datetime
    revision: int

    data: dict | None = None
    generation: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _populate_generation(self):
        if self.generation is None and isinstance(self.data, dict):
            self.generation = self.data.get("generation")
        return self

class ScheduleSlotBase(BaseModel):
    day_of_week: int
    lesson_number: int
    week_type: str
    room_override: Optional[str] = None
    is_substitution: Optional[bool] = False

class ScheduleSlotResponse(ScheduleSlotBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    draft_id: int
    curriculum: CurriculumResponse

class SlotMoveRequest(BaseModel):
    day_of_week: int
    lesson_number: int
    week_type: str
