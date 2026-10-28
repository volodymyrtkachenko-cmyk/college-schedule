from __future__ import annotations

from datetime import date, time
from datetime import date as DateType
from typing import Literal
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
    year_of_admission: int | None = None
    course: int | None = None


class TeacherResource(DirectoryResource):
    full_name: str | None = None
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
    year_of_admission: int | None = Field(default=None, gt=1900)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    faculty_id: int | None = Field(default=None, gt=0)
    curator_id: int | None = Field(default=None, gt=0)
    year_of_admission: int | None = Field(default=None, gt=1900)


class TeacherCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    full_name: str | None = Field(default=None, max_length=150)
    email: str | None = Field(default=None, max_length=255)
    room: str | None = Field(default=None, max_length=100)


class TeacherUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    full_name: str | None = Field(default=None, max_length=150)
    email: str | None = Field(default=None, max_length=255)
    room: str | None = Field(default=None, max_length=100)






class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=50)


class SubjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    short_name: str | None = Field(default=None, max_length=50)





class ScheduleItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    subject_id: int | None = None
    teacher_id: int | None = None
    second_teacher_id: int | None = None
    stream_id: str | None = None
    day_of_week: int
    lesson_number: int
    time: str
    subject: str
    teacher: str | None = None
    room: str | None = None
    room_override: str | None = None
    teacher_room: str | None = None
    second_teacher_room: str | None = None
    subject_name: str
    teacher_name: str | None = None
    week_type: str
    is_relevant_this_week: bool
    is_replacement: bool = False
    is_cancelled: bool = False
    group_id: int | None = None
    group_name: str | None = None
    note: str | None = None
    note_id: int | None = None
    note_revision: int = 0
    note_date: DateType | None = None
    event_type: str | None = None
    event_title: str | None = None
    custom_subject: str | None = None
    event_id: int | None = None
    moved_to_date: DateType | None = None
    moved_to_lesson: int | None = None
    has_template: bool | None = True
    is_online: bool = False
    has_protected_link: bool = False

class LearningModeOverride(BaseModel):
    start: date
    end: date
    mode: Literal["offline", "online"]
    courses: list[int] = Field(default_factory=list)
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_range(self):
        if self.end < self.start:
            raise ValueError("end must not precede start")
        if any(not 1 <= course <= 5 for course in self.courses):
            raise ValueError("courses must be between 1 and 5")
        return self


class ShortenedDayItem(BaseModel):
    date: date
    reason: str | None = Field(default=None, max_length=255)


class ShortenedDayTogglePayload(BaseModel):
    date: date
    reason: str | None = Field(default=None, max_length=255)


class SchedulePeriodInfo(BaseModel):
    id: int
    name: str
    period_type: str
    start_date: date
    end_date: date


class ScheduleResponse(BaseModel):
    date: date
    week_type: str
    lessons: list[ScheduleItem]
    learning_mode: str | None = None
    learning_mode_override: LearningModeOverride | None = None
    is_shortened_day: bool = False
    period_info: SchedulePeriodInfo | None = None


class LearningModeConfig(BaseModel):
    cycle_start: date | None = None
    weeks_per_phase: int = Field(default=2, ge=1, le=8)
    first_phase_offline_courses: list[int] = Field(default_factory=lambda: [1, 3])
    overrides: list[LearningModeOverride] = Field(default_factory=list)

    @field_validator("first_phase_offline_courses")
    @classmethod
    def valid_courses(cls, value):
        if any(not 1 <= course <= 5 for course in value):
            raise ValueError("courses must be between 1 and 5")
        return value


class SemesterStartSetting(BaseModel):
    value: date


class SemesterDatesSetting(BaseModel):
    semester_start: date | None = None
    semester_end: date | None = None
    configured: bool


class SemesterDatesUpdate(BaseModel):
    semester_start: date
    semester_end: date

    @model_validator(mode="after")
    def validate_date_order(self):
        if self.semester_end < self.semester_start:
            raise ValueError("semester_end must not precede semester_start")
        return self


class LessonMutation(BaseModel):
    version_id: int | None = None
    group_id: int | None = None
    subject_id: int | None = None
    teacher_id: int | None = None
    second_teacher_id: int | None = None
    day_of_week: int | None = None
    date: DateType | None = None
    lesson_number: int | None = None
    subject: str | None = None
    teacher: str | None = None
    room: str | None = None
    week_type: str | None = None
    is_replacement: bool | None = None
    note: str | None = None

    @field_validator("day_of_week")
    @classmethod
    def valid_day(cls, value):
        if value is not None and not 1 <= value <= 7:
            raise ValueError("day_of_week must be between 1 and 7")
        return value

    @field_validator("lesson_number")
    @classmethod
    def positive_lesson(cls, value):
        if value is not None and not (1 <= value <= 4):
            raise ValueError("lesson_number must be between 1 and 4")
        return value

    @field_validator("week_type")
    @classmethod
    def valid_week(cls, value):
        if value is not None and value not in {"numerator", "denominator", "both"}:
            raise ValueError("week_type must be numerator, denominator, or both")
        return value


