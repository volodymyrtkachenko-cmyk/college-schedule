"""Database models."""
from app.models.lesson_notes import LessonOccurrenceNote, LessonNoteRevision
from app.models.entities import (
    Feedback, Faculty, Group, Schedule, Setting, Subject, Teacher, User,
    TokenBlocklist, BellSchedule, ScheduleOverride, SchedulePeriod, SchedulePeriodSlot,
    ImportedScheduleChange, AcademicTerm, TermCourseSchedule, Curriculum, TeacherConstraint, ScheduleDraft,
    ScheduleSlot, ScheduleVersion, AcademicEvent, GroupStudent, ClassroomGroupBinding,
    ClassroomCredential, ClassroomTaskBrief,
)

__all__ = [
    "User", "Faculty", "Group", "Teacher", "Subject", "Schedule",
    "Feedback", "Setting", "TokenBlocklist", "BellSchedule",
    "ScheduleOverride", "SchedulePeriod", "SchedulePeriodSlot",
    "ImportedScheduleChange", "AcademicTerm", "TermCourseSchedule", "Curriculum", "TeacherConstraint",
    "ScheduleDraft", "ScheduleSlot", "ScheduleVersion", "AcademicEvent",
    "GroupStudent", "ClassroomGroupBinding", "ClassroomCredential", "ClassroomTaskBrief",
]
from . import bump_updated_at