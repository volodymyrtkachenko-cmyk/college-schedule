"""Allow the full schedule week type values."""

from alembic import op
import sqlalchemy as sa


revision = "0003_expand_schedule_week_type"
down_revision = "0002_auth"


def upgrade():
    with op.batch_alter_table("schedule") as batch_op:
        batch_op.alter_column(
            "week_type",
            existing_type=sa.String(length=10),
            type_=sa.String(length=20),
            existing_nullable=False,
        )


def downgrade():
    with op.batch_alter_table("schedule") as batch_op:
        batch_op.alter_column(
            "week_type",
            existing_type=sa.String(length=20),
            type_=sa.String(length=10),
            existing_nullable=False,
        )
