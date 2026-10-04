import sqlalchemy as sa
from datetime import date, datetime, time, timezone
from typing import Optional
from sqlalchemy import Table, Column, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, Time, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

user_group_access = Table(
    "user_group_access",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("group_id", ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
)

schedule_period_groups = Table(
    "schedule_period_groups",
    Base.metadata,
    Column("period_id", ForeignKey("schedule_periods.id", ondelete="CASCADE"), primary_key=True),
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
    year_of_admission: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    faculty: Mapped["Faculty"] = relationship(back_populates="groups")
    schedules: Mapped[list["Schedule"]] = relationship(back_populates="group")
    curriculums: Mapped[list["Curriculum"]] = relationship(back_populates="group")
    managers: Mapped[list["User"]] = relationship(secondary=user_group_access, back_populates="allowed_groups")

    @property
    def course(self) -> Optional[int]:
        if not self.year_of_admission:
            return None
        from datetime import date
        today = date.today()
        # Якщо зараз вересень або пізніше, академічний рік почався в цьому році
        # Якщо до вересня, то академічний рік почався минулого року
        current_academic_start_year = today.year if today.month >= 8 else today.year - 1
        course = current_academic_start_year - self.year_of_admission + 1
        # Зазвичай курс від 1 до 4 (або 5)
        return max(1, course)

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
    curriculums: Mapped[list["Curriculum"]] = relationship(back_populates="teacher", foreign_keys="Curriculum.teacher_id")
    constraints: Mapped[list["TeacherConstraint"]] = relationship(back_populates="teacher")


class Subject(Base):
    __tablename__ = "subjects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    short_name: Mapped[Optional[str]] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    schedules: Mapped[list["Schedule"]] = relationship(back_populates="subject")
    curriculums: Mapped[list["Curriculum"]] = relationship(back_populates="subject")

class ScheduleVersion(Base):
    __tablename__ = "schedule_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    valid_from: Mapped[date] = mapped_column(Date, index=True)
    valid_until: Mapped[date] = mapped_column(Date, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    schedules: Mapped[list["Schedule"]] = relationship(back_populates="version", cascade="all, delete-orphan")

class Schedule(Base):
    __tablename__ = "schedule"
    __table_args__ = (
        CheckConstraint("lesson_number BETWEEN 1 AND 4", name="chk_schedule_lesson_number"),
        Index("ix_schedule_group_day", "group_id", "day_of_week"),
        Index("ix_schedule_teacher_day", "teacher_id", "day_of_week"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), index=True)
    teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"))
    second_teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    stream_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    day_of_week: Mapped[int] = mapped_column(Integer, index=True)
    lesson_number: Mapped[int] = mapped_column(Integer)
    week_type: Mapped[str] = mapped_column(String(20), default="both")  # numerator, denominator, both
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_replacement: Mapped[bool] = mapped_column(Boolean, default=False)
    room_override: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    version_id: Mapped[Optional[int]] = mapped_column(ForeignKey("schedule_versions.id", ondelete="CASCADE"), nullable=True, index=True)
    
    group: Mapped["Group"] = relationship(back_populates="schedules")
    version: Mapped[Optional["ScheduleVersion"]] = relationship(back_populates="schedules")
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

class TokenBlocklist(Base):
    __tablename__ = "token_blocklist"
    id: Mapped[int] = mapped_column(primary_key=True)
    jti: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

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
    
    subject: Mapped[Optional["Subject"]] = relationship()
    teacher: Mapped[Optional["Teacher"]] = relationship()
    schedule: Mapped["Schedule"] = relationship()


class SchedulePeriod(Base):
    __tablename__ = "schedule_periods"
    __table_args__ = (
        CheckConstraint("period_type IN ('theory', 'session', 'practice', 'holiday', 'diploma', 'attestation')", name="ck_schedule_period_type"),
        CheckConstraint("start_date <= end_date", name="ck_schedule_period_dates"),
        Index("ix_schedule_period_dates", "start_date", "end_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    period_type: Mapped[str] = mapped_column(String(20))
    start_date: Mapped[date] = mapped_column(Date, index=True)
    end_date: Mapped[date] = mapped_column(Date, index=True)

    groups: Mapped[list["Group"]] = relationship(secondary=schedule_period_groups)
    slots: Mapped[list["SchedulePeriodSlot"]] = relationship(
        back_populates="period", cascade="all, delete-orphan"
    )


class SchedulePeriodSlot(Base):
    __tablename__ = "schedule_period_slots"
    __table_args__ = (
        UniqueConstraint("period_id", "group_id", "day_of_week", "lesson_number", name="uq_period_group_slot"),
        CheckConstraint("day_of_week BETWEEN 1 AND 5", name="ck_period_slot_weekday"),
        CheckConstraint("lesson_number BETWEEN 1 AND 4", name="ck_period_slot_lesson"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    period_id: Mapped[int] = mapped_column(ForeignKey("schedule_periods.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"))
    second_teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    day_of_week: Mapped[int] = mapped_column(Integer)
    lesson_number: Mapped[int] = mapped_column(Integer)
    room_override: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    source: Mapped[str] = mapped_column(String(50), default="manual")

    period: Mapped["SchedulePeriod"] = relationship(back_populates="slots")
    group: Mapped["Group"] = relationship()
    subject: Mapped["Subject"] = relationship()
    teacher: Mapped["Teacher"] = relationship(foreign_keys=[teacher_id])
    second_teacher: Mapped[Optional["Teacher"]] = relationship(foreign_keys=[second_teacher_id])

    @property
    def week_type(self) -> str:
        return "both"


class ImportedScheduleChange(Base):
    __tablename__ = "imported_schedule_changes"
    __table_args__ = (
        UniqueConstraint("date", "group_id", "lesson_number", "version", name="uq_imported_schedule_change_cell_version"),
        CheckConstraint("kind IN ('substitution', 'cancelled')", name="ck_imported_schedule_change_kind"),
        CheckConstraint("lesson_number BETWEEN 1 AND 4", name="ck_imported_schedule_change_lesson"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[Optional[int]] = mapped_column(ForeignKey("schedule_drafts.id", ondelete="SET NULL"), nullable=True, index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(20))
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    subject_id: Mapped[Optional[int]] = mapped_column(ForeignKey("subjects.id"), nullable=True)
    teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    second_teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    lesson_number: Mapped[int] = mapped_column(Integer)
    room_override: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)

    draft: Mapped[Optional["ScheduleDraft"]] = relationship()
    group: Mapped["Group"] = relationship()
    subject: Mapped[Optional["Subject"]] = relationship()
    teacher: Mapped[Optional["Teacher"]] = relationship(foreign_keys=[teacher_id])
    second_teacher: Mapped[Optional["Teacher"]] = relationship(foreign_keys=[second_teacher_id])

    @property
    def week_type(self) -> str:
        return "both"


class Curriculum(Base):
    __tablename__ = "curriculums"
    __table_args__ = (
        UniqueConstraint(
            "group_id", "subject_id", "teacher_id", "second_teacher_id",
            "is_stream", "stream_id", name="uq_curriculum_assignment",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"))
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"))
    second_teacher_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teachers.id"), nullable=True)
    pairs_per_2_weeks: Mapped[int] = mapped_column(Integer)
    total_hours: Mapped[int] = mapped_column(Integer, default=0)
    is_stream: Mapped[bool] = mapped_column(Boolean, default=False)
    stream_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    strict_day: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    strict_lesson: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    require_week: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    allow_multiple_per_day: Mapped[bool] = mapped_column(default=False)
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    
    group: Mapped["Group"] = relationship(back_populates="curriculums")
    subject: Mapped["Subject"] = relationship(back_populates="curriculums")
    teacher: Mapped["Teacher"] = relationship(back_populates="curriculums", foreign_keys=[teacher_id])
    second_teacher: Mapped[Optional["Teacher"]] = relationship(foreign_keys=[second_teacher_id])
    slots: Mapped[list["ScheduleSlot"]] = relationship(back_populates="curriculum")

class TeacherConstraint(Base):
    __tablename__ = "teacher_constraints"
    __table_args__ = (
        UniqueConstraint("teacher_id", "day_of_week", "lesson_number", name="uq_teacher_constraint_slot"),
    )
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
    draft_type: Mapped[str] = mapped_column(String(20), default="generated", server_default="generated")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    data: Mapped[Optional[dict]] = mapped_column(sa.JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
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
    is_substitution: Mapped[bool] = mapped_column(default=False)
    
    draft: Mapped["ScheduleDraft"] = relationship(back_populates="slots")
    curriculum: Mapped["Curriculum"] = relationship(back_populates="slots")

class EntityAlias(Base):
    __tablename__ = "entity_aliases"
    __table_args__ = (UniqueConstraint("entity_type", "parsed_name", name="uq_entity_alias_name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(50), index=True) # "subject", "teacher", "group"
    parsed_name: Mapped[str] = mapped_column(String(255), index=True)
    actual_id: Mapped[int] = mapped_column(Integer)
