"""add draft typing and audit safety constraints

Revision ID: 20261003_admin_audit_safety
Revises: c9d0e1f2a3b4
"""
from alembic import op
import sqlalchemy as sa

revision = "20261003_admin_audit_safety"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "schedule_drafts",
        sa.Column("draft_type", sa.String(length=20), nullable=False, server_default="generated"),
    )
    op.add_column(
        "imported_schedule_changes",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
    with op.batch_alter_table("imported_schedule_changes") as batch:
        batch.drop_constraint("uq_imported_schedule_change_cell", type_="unique")
        batch.create_unique_constraint(
            "uq_imported_schedule_change_cell_version",
            ["date", "group_id", "lesson_number", "version"],
        )
    with op.batch_alter_table("teacher_constraints") as batch:
        batch.create_unique_constraint(
            "uq_teacher_constraint_slot",
            ["teacher_id", "day_of_week", "lesson_number"],
        )
    with op.batch_alter_table("curriculums") as batch:
        batch.create_unique_constraint(
            "uq_curriculum_assignment",
            ["group_id", "subject_id", "teacher_id", "second_teacher_id", "is_stream", "stream_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("curriculums") as batch:
        batch.drop_constraint("uq_curriculum_assignment", type_="unique")
    with op.batch_alter_table("teacher_constraints") as batch:
        batch.drop_constraint("uq_teacher_constraint_slot", type_="unique")
    with op.batch_alter_table("imported_schedule_changes") as batch:
        batch.drop_constraint("uq_imported_schedule_change_cell_version", type_="unique")
        batch.create_unique_constraint(
            "uq_imported_schedule_change_cell",
            ["date", "group_id", "lesson_number"],
        )
    op.drop_column("imported_schedule_changes", "version")
    op.drop_column("schedule_drafts", "draft_type")
