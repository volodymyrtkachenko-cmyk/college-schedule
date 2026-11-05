"""Add performance indexes for classroom access, drafts, publications, and overrides

Revision ID: 20261105_perf_indexes
Revises: 20261102_academic_terms
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "20261105_perf_indexes"
down_revision = "20261102_academic_terms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Functional indexes for case-insensitive email lookup in Classroom access checks
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_classroom_cred_lower_email "
        "ON classroom_credentials (lower(email))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_group_students_lower_email "
        "ON group_students (lower(email))"
    )

    # 2. Composite index on schedule_drafts for draft_type and status filtering
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_drafts_type_status "
        "ON schedule_drafts (draft_type, status)"
    )

    # 3. Composite index on schedule_publications for reverted status and ordering
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_publications_reverted_id "
        "ON schedule_publications (is_reverted, id)"
    )

    # 4. Composite index on schedule_override for moved lesson lookup
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_override_group_moved "
        "ON schedule_override (group_id, moved_to_date, moved_to_lesson)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_override_group_moved")
    op.execute("DROP INDEX IF EXISTS ix_schedule_publications_reverted_id")
    op.execute("DROP INDEX IF EXISTS ix_schedule_drafts_type_status")
    op.execute("DROP INDEX IF EXISTS ix_group_students_lower_email")
    op.execute("DROP INDEX IF EXISTS ix_classroom_cred_lower_email")
