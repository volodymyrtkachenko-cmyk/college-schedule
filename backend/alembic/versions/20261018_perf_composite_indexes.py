"""Add composite performance indexes for projection lookups

Revision ID: 20261018_perf_composite_indexes
Revises: 20261018_import_manual_edit
"""
from alembic import op

revision = "20261018_perf_composite_indexes"
down_revision = "20261018_import_manual_edit"
branch_labels = None
depends_on = None


def upgrade():
    # 1. schedule: group weekly projection lookup (group -> version -> day -> slot)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_grp_ver_day_active "
        "ON schedule (group_id, version_id, day_of_week, lesson_number) "
        "WHERE is_active"
    )
    # 2. schedule: teacher weekly projection lookup
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_t1_active "
        "ON schedule (teacher_id, version_id, day_of_week) "
        "WHERE is_active"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_t2_active "
        "ON schedule (second_teacher_id, version_id, day_of_week) "
        "WHERE is_active AND second_teacher_id IS NOT NULL"
    )
    # 3. imported_schedule_changes: latest published cell lookup
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_imp_pub_cell_latest "
        "ON imported_schedule_changes (group_id, date, lesson_number, version DESC) "
        "WHERE is_published"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_imp_pub_teacher_date "
        "ON imported_schedule_changes (teacher_id, date) "
        "WHERE is_published"
    )
    # 4. schedule_override: teacher date lookup
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_override_teacher_date "
        "ON schedule_override (teacher_id, date) "
        "WHERE teacher_id IS NOT NULL"
    )
    # 5. schedule_events: group and teacher event lookups
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_group_date "
        "ON schedule_events (group_id, event_date)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_teacher_date "
        "ON schedule_events (teacher_id, event_date)"
    )


def downgrade():
    for name in [
        "ix_events_teacher_date",
        "ix_events_group_date",
        "ix_override_teacher_date",
        "ix_imp_pub_teacher_date",
        "ix_imp_pub_cell_latest",
        "ix_schedule_t2_active",
        "ix_schedule_t1_active",
        "ix_schedule_grp_ver_day_active",
    ]:
        op.execute(f"DROP INDEX IF EXISTS {name}")
