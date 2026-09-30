from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional
from .curriculum import CurriculumResponse

class ScheduleDraftResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    status: str
    created_at: datetime

class ScheduleSlotBase(BaseModel):
    day_of_week: int
    lesson_number: int
    week_type: str
    room_override: Optional[str] = None

class ScheduleSlotResponse(ScheduleSlotBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    draft_id: int
    curriculum: CurriculumResponse

class SlotMoveRequest(BaseModel):
    day_of_week: int
    lesson_number: int
    week_type: str
