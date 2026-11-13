"""Pydantic schemas for schedule versions."""
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

VersionName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class ScheduleVersionBase(BaseModel):
    name: VersionName
    valid_from: date
    valid_until: date
    is_active: bool = True

    @model_validator(mode="after")
    def valid_dates(self):
        if self.valid_from > self.valid_until:
            raise ValueError("valid_from must not be after valid_until")
        return self


class ScheduleVersionCreate(ScheduleVersionBase):
    pass


class ScheduleVersionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: VersionName | None = None
    valid_from: date | None = None
    valid_until: date | None = None
    is_active: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, value):
        if isinstance(value, dict):
            for key in ("name", "valid_from", "valid_until", "is_active"):
                if key in value and value[key] is None:
                    raise ValueError(f"{key} must not be null")
        return value


class ScheduleVersionResponse(ScheduleVersionBase):
    id: int
    lessons_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class PublicationResponse(BaseModel):
    id: int
    version_id: int | None
    actor_id: int | None
    timestamp: datetime
    scope_manifest: str
    is_reverted: bool
    source: str = "manual"
    changes_count: int = 0
