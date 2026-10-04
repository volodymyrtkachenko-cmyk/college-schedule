from pydantic import BaseModel
from typing import List, Optional
from datetime import date

class WeekInfo(BaseModel):
    week_number: int
    start_date: date
    end_date: date

class CellInfo(BaseModel):
    week_number: int
    period_type: str
    name: Optional[str] = None

class GroupProcessInfo(BaseModel):
    group_id: int
    group_name: str
    cells: List[CellInfo]

class CourseProcessInfo(BaseModel):
    course: int
    groups: List[GroupProcessInfo]

class EducationalProcessMatrix(BaseModel):
    academic_year_start: int
    weeks: List[WeekInfo]
    courses: List[CourseProcessInfo]
