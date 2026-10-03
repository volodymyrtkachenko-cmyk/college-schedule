from pydantic import BaseModel, ConfigDict, Field
from typing import Optional
from .common import DirectoryItem
from datetime import datetime

class TeacherConstraintBase(BaseModel):
    teacher_id: int = Field(gt=0)
    day_of_week: int = Field(ge=1, le=5)
    lesson_number: int = Field(ge=1, le=4)
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
    draft_type: str
    status: str
    created_at: datetime
