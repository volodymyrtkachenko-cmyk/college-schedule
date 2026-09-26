from __future__ import annotations

from datetime import date, time
from datetime import date as DateType
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class DirectoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class DirectoryResource(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: bool


class FacultyResource(DirectoryResource):
    short_name: str | None = None


class GroupResource(DirectoryResource):
    faculty_id: int | None = None
    curator_id: int | None = None


class TeacherResource(DirectoryResource):
    email: str | None = None
    room: str | None = None




class SubjectResource(DirectoryResource):
    short_name: str | None = None


class FacultyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=50)


class FacultyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=50)


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    faculty_id: int | None = Field(default=None, gt=0)
    curator_id: int | None = Field(default=None, gt=0)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    faculty_id: int | None = Field(default=None, gt=0)
    curator_id: int | None = Field(default=None, gt=0)


class TeacherCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    room: str | None = Field(default=None, max_length=100)


class TeacherUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    room: str | None = Field(default=None, max_length=100)






class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=50)


class SubjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=50)


# Фіксований розклад часу пар за номером пари.
# Вхідні start_time/end_time від клієнта ігноруються — час завжди підставляється звідси.
LESSON_TIMES: dict[int, tuple[time, time]] = {
    1: (time(9, 0), time(10, 20)),
    2: (time(10, 40), time(12, 0)),
    3: (time(12, 30), time(13, 50)),
    4: (time(14, 0), time(15, 20)),
}


class ScheduleItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    subject_id: int
    teacher_id: int | None = None
    second_teacher_id: int | None = None
    day_of_week: int
    lesson_number: int
    time: str
    subject: str
    teacher: str | None = None
    room: str | None = None
    subject_name: str
    teacher_name: str | None = None
    week_type: str
    is_relevant_this_week: bool
    is_replacement: bool = False
    group_id: int | None = None
    group_name: str | None = None
    note: str | None = None
    note_id: int | None = None

class ScheduleResponse(BaseModel):
    date: date
    week_type: str
    lessons: list[ScheduleItem]


class SemesterStartSetting(BaseModel):
    value: date


class LessonMutation(BaseModel):
    group_id: int | None = None
    subject_id: int | None = None
    teacher_id: int | None = None
    second_teacher_id: int | None = None
    day_of_week: int | None = None
    date: DateType | None = None
    lesson_number: int | None = None
    start_time: time | None = None
    end_time: time | None = None
    subject: str | None = None
    teacher: str | None = None
    room: str | None = None
    week_type: str | None = None
    is_replacement: bool | None = None
    note: str | None = None

    @field_validator("day_of_week")
    @classmethod
    def valid_day(cls, value):
        if value is not None and not 1 <= value <= 5:
            raise ValueError("day_of_week must be between 1 and 5")
        return value

    @field_validator("lesson_number")
    @classmethod
    def positive_lesson(cls, value):
        if value is not None and value < 1:
            raise ValueError("lesson_number must be positive")
        return value

    @field_validator("week_type")
    @classmethod
    def valid_week(cls, value):
        if value is not None and value not in {"numerator", "denominator", "both"}:
            raise ValueError("week_type must be numerator, denominator, or both")
        return value

    @model_validator(mode="after")
    def apply_fixed_times(self):
        # Час пари завжди визначається за lesson_number, а не за введеними значеннями.
        if self.lesson_number is not None and self.lesson_number in LESSON_TIMES:
            self.start_time, self.end_time = LESSON_TIMES[self.lesson_number]
        if self.start_time is not None and self.end_time is not None and self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self


class LessonNoteCreate(BaseModel):
    schedule_id: int = Field(gt=0)
    note_date: DateType
    note: str = Field(min_length=1, max_length=10000)

    @model_validator(mode="before")
    @classmethod
    def accept_public_names(cls, value):
        if isinstance(value, dict):
            value = dict(value)
            if "target_date" in value and "note_date" not in value:
                value["note_date"] = value["target_date"]
            if "content" in value and "note" not in value:
                value["note"] = value["content"]
        return value

    @field_validator("note")
    @classmethod
    def non_blank_note(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("note must not be blank")
        return value


class LessonNoteUpdate(BaseModel):
    schedule_id: int | None = Field(default=None, gt=0)
    note_date: DateType | None = None
    note: str | None = Field(default=None, min_length=1, max_length=10000)

    @model_validator(mode="before")
    @classmethod
    def accept_public_names(cls, value):
        if isinstance(value, dict):
            value = dict(value)
            if "target_date" in value and "note_date" not in value:
                value["note_date"] = value["target_date"]
            if "content" in value and "note" not in value:
                value["note"] = value["content"]
        return value

    @field_validator("note")
    @classmethod
    def non_blank_note(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("note must not be blank")
        return value

    @model_validator(mode="after")
    def has_changes(self):
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class LessonNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    schedule_id: int
    note_date: DateType
    note: str