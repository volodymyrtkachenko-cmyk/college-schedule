from pydantic import BaseModel, ConfigDict
from typing import Optional
from .common import DirectoryItem
from datetime import datetime

class TeacherConstraintBase(BaseModel):
    teacher_id: int
    day_of_week: int
    lesson_number: int
    is_hard_constraint: bool = True

class TeacherConstraintCreate(TeacherConstraintBase):
    pass

class TeacherConstraintUpdate(BaseModel):
    day_of_week: Optional[int] = None
    lesson_number: Optional[int] = None
    is_hard_constraint: Optional[bool] = None

class TeacherConstraintResponse(TeacherConstraintBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    teacher: DirectoryItem

class ScheduleDraftResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    status: str
    created_at: datetime
