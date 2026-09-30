from datetime import date, datetime, time
from typing import Optional
from sqlalchemy import Table, Column, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

user_group_access = Table(
    "user_group_access",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("group_id", ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    allowed_groups: Mapped[list["Group"]] = relationship(secondary=user_group_access, back_populates="managers")

class Faculty(Base):
    __tablename__ = "faculties"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    short_name: Mapped[Optional[str]] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    groups: Mapped[list["Group"]] = relationship(back_populates="faculty")

class Group(Base):
    __tablename__ = "groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    faculty_id: Mapped[Optional[int]] = mapped_column(ForeignKey("faculties.id"), nullable=True)
    curator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    faculty: Mapped["Faculty"] = relationship(back_populates="groups")
    schedules: Mapped[list["Schedule"]] = relationship(back_populates="group")
    curriculums: Mapped[list["Curriculum"]] = relationship(back_populates="group")
    managers: Mapped[list["User"]] = relationship(secondary=user_group_access, back_populates="allowed_groups")

class Teacher(Base):
    __tablename__ = "teachers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255))
    room: Mapped[Optional[str]] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    schedules: Mapped[list["Schedule"]] = relationship(
        back_populates="teacher", foreign_keys="Schedule.teacher_id"
    )

    

class Subject(Base):
    __tablename__ = "subjects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    short_name: Mapped[Optional[str]] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    schedules: Mapped[list["Schedule"]] = relationship(back_populates="subject")
    curriculums: Mapped[list["Curriculum"]] = relationship(back_populates="subject")

class Schedule(Base):
    __tablename__ = "schedule"
    __table_args__ = (
        Index("ix_schedule_group_day", "group_id", "day_of_week"),
        Index("ix_schedule_teacher_day", "teacher_id", "day_of_week"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), index=True)
    teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"))
    second_teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    day_of_week: Mapped[int] = mapped_column(Integer, index=True)
    lesson_number: Mapped[int] = mapped_column(Integer)
    week_type: Mapped[str] = mapped_column(String(20), default="both")  # numerator, denominator, both
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_replacement: Mapped[bool] = mapped_column(Boolean, default=False)
    room_override: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    group: Mapped["Group"] = relationship(back_populates="schedules")
    teacher: Mapped[Optional["Teacher"]] = relationship(
        back_populates="schedules", foreign_keys=[teacher_id]
    )
    second_teacher: Mapped[Optional["Teacher"]] = relationship(foreign_keys=[second_teacher_id])
    subject: Mapped["Subject"] = relationship(back_populates="schedules")
    notes: Mapped[list["LessonNote"]] = relationship(back_populates="schedule")

class LessonNote(Base):
    __tablename__ = "lesson_notes"
    __table_args__ = (UniqueConstraint("schedule_id", "note_date", name="uq_lesson_notes_schedule_date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedule.id"), index=True)
    note_date: Mapped[date] = mapped_column(Date, index=True)
    note: Mapped[str] = mapped_column(Text)
    schedule: Mapped["Schedule"] = relationship(back_populates="notes")

class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
class TokenBlocklist(Base):
    __tablename__ = "token_blocklist"
    id: Mapped[int] = mapped_column(primary_key=True)
    jti: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class BellSchedule(Base):
    __tablename__ = "bell_schedule"
    id: Mapped[int] = mapped_column(primary_key=True)
    lesson_number: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class ScheduleOverride(Base):
    __tablename__ = "schedule_override"
    __table_args__ = (UniqueConstraint("schedule_id", "date", name="uq_schedule_override_date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedule.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"))
    subject_id: Mapped[Optional[int]] = mapped_column(ForeignKey("subjects.id"))
    room: Mapped[Optional[str]] = mapped_column(String(100))
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)


class Curriculum(Base):
    __tablename__ = "curriculums"
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"))
    second_teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    pairs_per_2_weeks: Mapped[int] = mapped_column(Integer)
    is_stream: Mapped[bool] = mapped_column(Boolean, default=False)
    stream_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    
    group: Mapped["Group"] = relationship(back_populates="curriculums")
    subject: Mapped["Subject"] = relationship(back_populates="curriculums")
    teacher: Mapped["Teacher"] = relationship(back_populates="curriculums", foreign_keys=[teacher_id])
    second_teacher: Mapped[Optional["Teacher"]] = relationship(foreign_keys=[second_teacher_id])
    slots: Mapped[list["ScheduleSlot"]] = relationship(back_populates="curriculum")

class TeacherConstraint(Base):
    __tablename__ = "teacher_constraints"
    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"), index=True)
    day_of_week: Mapped[int] = mapped_column(Integer)
    lesson_number: Mapped[int] = mapped_column(Integer)
    is_hard_constraint: Mapped[bool] = mapped_column(Boolean, default=True)
    
    teacher: Mapped["Teacher"] = relationship(back_populates="constraints")

class ScheduleDraft(Base):
    __tablename__ = "schedule_drafts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    slots: Mapped[list["ScheduleSlot"]] = relationship(back_populates="draft")

class ScheduleSlot(Base):
    __tablename__ = "schedule_slots"
    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("schedule_drafts.id", ondelete="CASCADE"), index=True)
    curriculum_id: Mapped[int] = mapped_column(ForeignKey("curriculums.id"), index=True)
    day_of_week: Mapped[int] = mapped_column(Integer)
    lesson_number: Mapped[int] = mapped_column(Integer)
    week_type: Mapped[str] = mapped_column(String(20), default="both")
    room_override: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    draft: Mapped["ScheduleDraft"] = relationship(back_populates="slots")
    curriculum: Mapped["Curriculum"] = relationship(back_populates="slots")
