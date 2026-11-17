"""Add missing FK and composite indexes from audit (#22)

Revision ID: 20261117_audit_missing_indexes
Revises: 20261116_classroom_task_briefs
Create Date: 2026-11-17
"""
from alembic import op

revision = "20261117_audit_missing_indexes"
down_revision = "20261116_classroom_task_briefs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_groups_faculty_id ON groups (faculty_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_groups_curator_id ON groups (curator_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_curriculums_subject_id ON curriculums (subject_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_curriculums_teacher_id ON curriculums (teacher_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_curriculums_second_teacher_id ON curriculums (second_teacher_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_period_slots_subject_id ON schedule_period_slots (subject_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_period_slots_teacher_id ON schedule_period_slots (teacher_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_period_slots_second_teacher_id ON schedule_period_slots (second_teacher_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_drafts_type_status ON schedule_drafts (draft_type, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_slots_draft_day_lesson ON schedule_slots (draft_id, day_of_week, lesson_number)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_events_subject_id ON schedule_events (subject_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_events_group_date ON schedule_events (group_id, event_date)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_group_students_email ON group_students (email)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_classroom_credentials_email ON classroom_credentials (email)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_classroom_cred_active_sync ON classroom_credentials (group_id, is_active, needs_relink)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_classroom_cred_active_sync")
    op.execute("DROP INDEX IF EXISTS ix_classroom_credentials_email")
    op.execute("DROP INDEX IF EXISTS ix_group_students_email")
    op.execute("DROP INDEX IF EXISTS ix_schedule_events_group_date")
    op.execute("DROP INDEX IF EXISTS ix_schedule_events_subject_id")
    op.execute("DROP INDEX IF EXISTS ix_schedule_slots_draft_day_lesson")
    op.execute("DROP INDEX IF EXISTS ix_schedule_drafts_type_status")
    op.execute("DROP INDEX IF EXISTS ix_schedule_period_slots_second_teacher_id")
    op.execute("DROP INDEX IF EXISTS ix_schedule_period_slots_teacher_id")
    op.execute("DROP INDEX IF EXISTS ix_schedule_period_slots_subject_id")
    op.execute("DROP INDEX IF EXISTS ix_curriculums_second_teacher_id")
    op.execute("DROP INDEX IF EXISTS ix_curriculums_teacher_id")
    op.execute("DROP INDEX IF EXISTS ix_curriculums_subject_id")
    op.execute("DROP INDEX IF EXISTS ix_groups_curator_id")
    op.execute("DROP INDEX IF EXISTS ix_groups_faculty_id")
