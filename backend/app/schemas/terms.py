from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class TermCourseScheduleBase(BaseModel):
    course: int = Field(ge=1, le=4)
    total_weeks: int = Field(default=17, ge=1, le=30)
    practice_weeks: int = Field(default=0, ge=0, le=30)
    practice_timing: str = Field(default="NONE")  # START, MIDDLE, END, NONE
    practice_start_week: Optional[int] = Field(default=None, ge=1, le=30)
    practice_end_week: Optional[int] = Field(default=None, ge=1, le=30)
    theory_weeks: int = Field(default=17, ge=0, le=30)


class TermCourseScheduleResponse(TermCourseScheduleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    term_id: int


class AcademicTermBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    academic_year: str = Field(default="2025/2026", max_length=20)
    semester_number: int = Field(default=1, ge=1, le=2)
    start_date: date
    end_date: date
    total_weeks: int = Field(default=17, ge=1, le=30)
    is_current: bool = False
    status: str = Field(default="ACTIVE")  # ACTIVE, PLANNING, ARCHIVED


class AcademicTermCreate(AcademicTermBase):
    course_schedules: Optional[List[TermCourseScheduleBase]] = None


class AcademicTermUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    academic_year: Optional[str] = Field(default=None, max_length=20)
    semester_number: Optional[int] = Field(default=None, ge=1, le=2)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    total_weeks: Optional[int] = Field(default=None, ge=1, le=30)
    is_current: Optional[bool] = None
    status: Optional[str] = None
    course_schedules: Optional[List[TermCourseScheduleBase]] = None


class AcademicTermResponse(AcademicTermBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    course_schedules: List[TermCourseScheduleResponse] = []


class CloneTermRequest(BaseModel):
    source_term_id: int
    recalculate_hours: bool = True


class WorkloadCalculationResponse(BaseModel):
    theory_weeks: int
    total_hours: int
    pairs_per_2_weeks: int