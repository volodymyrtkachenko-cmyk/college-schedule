from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Any, Optional
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
    revision: Optional[int] = None
    # Settings used and outcome of an automatic generation (generated drafts only).
    generation: Optional[dict[str, Any]] = None

    @model_validator(mode="before")
    @classmethod
    def _extract_generation(cls, value: Any) -> Any:
        if isinstance(value, dict):
            if "generation" not in value and isinstance(value.get("data"), dict):
                return {**value, "generation": value["data"].get("generation")}
            return value
        data = getattr(value, "data", None)
        return {
            "id": value.id,
            "name": value.name,
            "draft_type": value.draft_type,
            "status": value.status,
            "created_at": value.created_at,
            "revision": getattr(value, "revision", None),
            "generation": data.get("generation") if isinstance(data, dict) else None,
        }
