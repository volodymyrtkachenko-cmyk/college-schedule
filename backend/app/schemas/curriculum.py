from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Optional
from .common import DirectoryItem

class CurriculumBase(BaseModel):
    group_id: int = Field(gt=0)
    subject_id: int = Field(gt=0)
    teacher_id: int = Field(gt=0)
    second_teacher_id: Optional[int] = Field(default=None, gt=0)
    pairs_per_2_weeks: int = Field(ge=0, le=50)
    total_hours: int = Field(default=0, ge=0)
    is_stream: bool = False
    is_fixed: bool = False
    stream_id: Optional[str] = Field(default=None, max_length=100)
    strict_day: Optional[int] = Field(default=None, ge=1, le=5)
    strict_lesson: Optional[int] = Field(default=None, ge=1, le=4)
    require_week: Optional[str] = None
    allow_multiple_per_day: Optional[bool] = None

class CurriculumCreate(CurriculumBase):
    @model_validator(mode="after")
    def validate_teachers(self) -> 'CurriculumCreate':
        if self.second_teacher_id and self.teacher_id == self.second_teacher_id:
            raise ValueError("Вчитель та другий вчитель не можуть бути однією особою")
        return self

class CurriculumUpdate(BaseModel):
    group_id: Optional[int] = Field(default=None, gt=0)
    subject_id: Optional[int] = Field(default=None, gt=0)
    teacher_id: Optional[int] = Field(default=None, gt=0)
    second_teacher_id: Optional[int] = Field(default=None, gt=0)
    pairs_per_2_weeks: Optional[int] = Field(default=None, ge=0, le=50)
    total_hours: Optional[int] = Field(default=None, ge=0)
    is_stream: Optional[bool] = None
    is_fixed: Optional[bool] = None
    stream_id: Optional[str] = Field(default=None, max_length=100)
    strict_day: Optional[int] = Field(default=None, ge=1, le=5)
    strict_lesson: Optional[int] = Field(default=None, ge=1, le=4)
    require_week: Optional[str] = None
    allow_multiple_per_day: Optional[bool] = None

    @model_validator(mode="after")
    def validate_teachers(self) -> 'CurriculumUpdate':
        # Simple cross-check if both are provided during update
        if self.teacher_id and self.second_teacher_id and self.teacher_id == self.second_teacher_id:
            raise ValueError("Вчитель та другий вчитель не можуть бути однією особою")
        return self

class CurriculumResponse(CurriculumBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    group: DirectoryItem
    subject: DirectoryItem
    teacher: DirectoryItem
    second_teacher: Optional[DirectoryItem] = None
