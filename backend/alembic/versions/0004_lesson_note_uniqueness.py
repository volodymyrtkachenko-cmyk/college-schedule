"""Ensure one note per scheduled lesson and calendar date."""

from alembic import op


revision = "0004_lesson_note_uniqueness"
down_revision = "0003_expand_schedule_week_type"


def upgrade():
    op.create_index(
        "uq_lesson_notes_schedule_date",
        "lesson_notes",
        ["schedule_id", "note_date"],
        unique=True,
    )


def downgrade():
    op.drop_index("uq_lesson_notes_schedule_date", table_name="lesson_notes")
