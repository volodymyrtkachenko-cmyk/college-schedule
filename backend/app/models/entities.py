from datetime import date, datetime, time
from typing import Optional
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

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

class Schedule(Base):
    __tablename__ = "schedule"
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), index=True)
    teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"))
    second_teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    day_of_week: Mapped[int] = mapped_column(Integer, index=True)
    lesson_number: Mapped[int] = mapped_column(Integer)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    week_type: Mapped[str] = mapped_column(String(20), default="both")  # numerator, denominator, both
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
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