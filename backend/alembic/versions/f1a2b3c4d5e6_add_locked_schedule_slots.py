"""Add lock state to generated schedule slots."""
from alembic import op
import sqlalchemy as sa

revision = "f1a2b3c4d5e6"
down_revision = "20261030_revert_academic_terms"


def upgrade():
    op.add_column(
        "schedule_slots",
        sa.Column("is_locked", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index("ix_schedule_slots_is_locked", "schedule_slots", ["is_locked"])


def downgrade():
    op.drop_index("ix_schedule_slots_is_locked", table_name="schedule_slots")
    op.drop_column("schedule_slots", "is_locked")
