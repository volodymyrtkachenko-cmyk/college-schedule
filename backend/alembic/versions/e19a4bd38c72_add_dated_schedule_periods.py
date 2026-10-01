"""Add dated practice and holiday periods.

Revision ID: e19a4bd38c72
Revises: 3d9c27bbb9a9
"""
from alembic import op
import sqlalchemy as sa


revision = "e19a4bd38c72"
down_revision = "3d9c27bbb9a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schedule_periods",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("period_type", sa.String(length=20), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.CheckConstraint("period_type IN ('practice', 'holiday')", name="ck_schedule_period_type"),
        sa.CheckConstraint("start_date <= end_date", name="ck_schedule_period_dates"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedule_period_dates", "schedule_periods", ["start_date", "end_date"])
    op.create_index(op.f("ix_schedule_periods_start_date"), "schedule_periods", ["start_date"])
    op.create_index(op.f("ix_schedule_periods_end_date"), "schedule_periods", ["end_date"])

    op.create_table(
        "schedule_period_groups",
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["period_id"], ["schedule_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("period_id", "group_id"),
    )

    op.create_table(
        "schedule_period_slots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("second_teacher_id", sa.Integer(), nullable=True),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("lesson_number", sa.Integer(), nullable=False),
        sa.Column("room_override", sa.String(length=100), nullable=True),
        sa.CheckConstraint("day_of_week BETWEEN 1 AND 5", name="ck_period_slot_weekday"),
        sa.CheckConstraint("lesson_number BETWEEN 1 AND 4", name="ck_period_slot_lesson"),
        sa.ForeignKeyConstraint(["period_id"], ["schedule_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_id"], ["subjects.id"]),
        sa.ForeignKeyConstraint(["teacher_id"], ["teachers.id"]),
        sa.ForeignKeyConstraint(["second_teacher_id"], ["teachers.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period_id", "group_id", "day_of_week", "lesson_number", name="uq_period_group_slot"),
    )
    op.create_index(op.f("ix_schedule_period_slots_period_id"), "schedule_period_slots", ["period_id"])
    op.create_index(op.f("ix_schedule_period_slots_group_id"), "schedule_period_slots", ["group_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_schedule_period_slots_group_id"), table_name="schedule_period_slots")
    op.drop_index(op.f("ix_schedule_period_slots_period_id"), table_name="schedule_period_slots")
    op.drop_table("schedule_period_slots")
    op.drop_table("schedule_period_groups")
    op.drop_index(op.f("ix_schedule_periods_end_date"), table_name="schedule_periods")
    op.drop_index(op.f("ix_schedule_periods_start_date"), table_name="schedule_periods")
    op.drop_index("ix_schedule_period_dates", table_name="schedule_periods")
    op.drop_table("schedule_periods")
