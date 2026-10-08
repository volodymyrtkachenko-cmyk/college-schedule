from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


class NoteWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject_id: int = Field(gt=0)
    note: str = Field(min_length=1, max_length=10000)
    expected_revision: int = Field(ge=0)

    @field_validator("note")
    @classmethod
    def strip_note(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Примітка не може бути порожньою")
        return value


class NoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    group_id: int
    note_date: date
    lesson_number: int
    subject_id: int
    subject_name: str
    note: str
    revision: int
    archived: bool
    updated_at: datetime


class NoteRevisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    note_id: int
    revision: int
    event: str
    snapshot: dict
    created_at: datetime
