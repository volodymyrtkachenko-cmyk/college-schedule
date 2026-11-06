"""Consolidate runtime indexes and schema declarations from main.py into Alembic

Revision ID: 20261106_consolidate_indexes
Revises: 20261105_perf_indexes
Create Date: 2026-11-06
"""
from alembic import op
import sqlalchemy as sa

revision = "20261106_consolidate_indexes"
down_revision = "20261105_perf_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else "postgresql"

    if dialect == "postgresql":
        # Ensure idempotent column additions/modifications previously executed in main.py lifespan
        op.execute("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS full_name VARCHAR(150)")
        op.execute("ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email VARCHAR(255)")
        op.execute("ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS lesson_number INTEGER")
        op.execute("ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS custom_subject VARCHAR(200)")
        op.execute("ALTER TABLE schedule_publications ADD COLUMN IF NOT EXISTS is_reverted BOOLEAN NOT NULL DEFAULT FALSE")
        op.execute("ALTER TABLE schedule_publications ALTER COLUMN actor_id DROP NOT NULL")
        op.execute("ALTER TABLE imported_schedule_changes ADD COLUMN IF NOT EXISTS change_type VARCHAR(20) DEFAULT 'substitution'")
        op.execute(
            "ALTER TABLE imported_schedule_changes "
            "ADD COLUMN IF NOT EXISTS publication_id INTEGER REFERENCES schedule_publications(id) ON DELETE CASCADE"
        )

    # Composite and lookup indexes previously managed in main.py lifespan
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_imported_schedule_changes_publication_id "
        "ON imported_schedule_changes (publication_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_active_lookup "
        "ON schedule (version_id, is_active, day_of_week, group_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_second_teacher_day "
        "ON schedule (second_teacher_id, day_of_week)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_subject_id "
        "ON schedule (subject_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_imp_changes_lookup "
        "ON imported_schedule_changes (date, is_published, group_id, lesson_number, version DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_imp_changes_teacher "
        "ON imported_schedule_changes (date, is_published, teacher_id, second_teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_override_date_group "
        "ON schedule_override (date, group_id, lesson_number)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_override_teacher "
        "ON schedule_override (date, teacher_id, second_teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notes_week_lookup "
        "ON lesson_occurrence_notes (note_date, group_id, archived)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notes_week_lookup")
    op.execute("DROP INDEX IF EXISTS ix_override_teacher")
    op.execute("DROP INDEX IF EXISTS ix_override_date_group")
    op.execute("DROP INDEX IF EXISTS ix_imp_changes_teacher")
    op.execute("DROP INDEX IF EXISTS ix_imp_changes_lookup")
    op.execute("DROP INDEX IF EXISTS ix_schedule_active_lookup")
    op.execute("DROP INDEX IF EXISTS ix_imported_schedule_changes_publication_id")
