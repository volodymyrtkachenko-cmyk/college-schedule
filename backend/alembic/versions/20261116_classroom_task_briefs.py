"""Add classroom_task_briefs cache table

Revision ID: 20261116_classroom_task_briefs
Revises: 20261110_classroom_relink_fields
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa

revision = "20261116_classroom_task_briefs"
down_revision = "20261110_classroom_relink_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "classroom_task_briefs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "group_id",
            sa.Integer(),
            sa.ForeignKey("groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("task_url", sa.String(length=512), nullable=False),
        sa.Column("coursework_id", sa.String(length=128), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("steps_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("estimated_minutes", sa.Integer(), nullable=True),
        sa.Column("work_format", sa.String(length=24), nullable=False, server_default="pc"),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="heuristic"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("group_id", "task_url", name="uq_classroom_task_brief_group_url"),
    )
    op.create_index("ix_classroom_task_briefs_group_id", "classroom_task_briefs", ["group_id"])
    op.create_index("ix_classroom_task_briefs_task_url", "classroom_task_briefs", ["task_url"])


def downgrade() -> None:
    op.drop_index("ix_classroom_task_briefs_task_url", table_name="classroom_task_briefs")
    op.drop_index("ix_classroom_task_briefs_group_id", table_name="classroom_task_briefs")
    op.drop_table("classroom_task_briefs")
