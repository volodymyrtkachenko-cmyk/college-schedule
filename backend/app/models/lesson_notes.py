"""Calendar occurrence notes, independent of replaceable schedule row IDs."""
from datetime import date, datetime, timezone
from sqlalchemy import Boolean, column, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class LessonOccurrenceNote(Base):
    __tablename__ = "lesson_occurrence_notes"
    __table_args__ = (
        CheckConstraint("lesson_number BETWEEN 1 AND 4", name="ck_occurrence_note_slot"),
        CheckConstraint("length(trim(note)) BETWEEN 1 AND 10000", name="ck_occurrence_note_text"),
        CheckConstraint("revision > 0", name="ck_occurrence_note_revision"),
        Index("uq_occurrence_note_active", "group_id", "note_date", "lesson_number", unique=True,
              postgresql_where=(column('archived') == False),
              sqlite_where=(column('archived') == False)),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="RESTRICT"), index=True)
    note_date: Mapped[date] = mapped_column(Date, index=True)
    lesson_number: Mapped[int] = mapped_column(Integer)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="RESTRICT"))
    subject_name: Mapped[str] = mapped_column(String(255))
    note: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    origin_kind: Mapped[str] = mapped_column(String(30))
    # Provenance only, deliberately not a FK to replaceable schedule rows.
    origin_id: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LessonNoteRevision(Base):
    __tablename__ = "lesson_note_revisions"
    __table_args__ = (UniqueConstraint("note_id", "revision", name="uq_note_revision"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("lesson_occurrence_notes.id", ondelete="RESTRICT"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    group_id: Mapped[int] = mapped_column(Integer, index=True)
    note_date: Mapped[date] = mapped_column(Date, index=True)
    lesson_number: Mapped[int] = mapped_column(Integer)
    event: Mapped[str] = mapped_column(String(30))
    snapshot: Mapped[dict] = mapped_column(JSON)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
