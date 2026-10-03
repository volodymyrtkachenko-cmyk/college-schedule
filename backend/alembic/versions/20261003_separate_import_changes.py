"""separate imported changes from calendar periods

Revision ID: c9d0e1f2a3b4
Revises: b8b9c0d1e2f4
"""
from alembic import op
import sqlalchemy as sa

revision = "c9d0e1f2a3b4"
down_revision = "b8b9c0d1e2f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "imported_schedule_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("draft_id", sa.Integer(), sa.ForeignKey("schedule_drafts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subjects.id"), nullable=True),
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("teachers.id"), nullable=True),
        sa.Column("second_teacher_id", sa.Integer(), sa.ForeignKey("teachers.id"), nullable=True),
        sa.Column("lesson_number", sa.Integer(), nullable=False),
        sa.Column("room_override", sa.String(length=100), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("kind IN ('substitution', 'cancelled')", name="ck_imported_schedule_change_kind"),
        sa.CheckConstraint("lesson_number BETWEEN 1 AND 4", name="ck_imported_schedule_change_lesson"),
        sa.UniqueConstraint("date", "group_id", "lesson_number", name="uq_imported_schedule_change_cell"),
    )
    op.create_index("ix_imported_schedule_changes_date", "imported_schedule_changes", ["date"])
    op.create_index("ix_imported_schedule_changes_draft_id", "imported_schedule_changes", ["draft_id"])
    op.create_index("ix_imported_schedule_changes_group_id", "imported_schedule_changes", ["group_id"])
    op.create_index("ix_imported_schedule_changes_is_published", "imported_schedule_changes", ["is_published"])
    op.execute("DELETE FROM schedule_period_slots WHERE source = 'import'")
    op.execute("DELETE FROM schedule_periods WHERE period_type = 'substitution'")
    op.execute("ALTER TABLE schedule_periods DROP CONSTRAINT ck_schedule_period_type")
    op.execute("ALTER TABLE schedule_periods ADD CONSTRAINT ck_schedule_period_type CHECK (period_type IN ('practice', 'holiday'))")


def downgrade() -> None:
    op.drop_table("imported_schedule_changes")
