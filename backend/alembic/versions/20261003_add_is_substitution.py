"""add is_substitution to schedule_slots

Revision ID: f8a7b9c0d1e3
Revises: d8a7b9c0d1e2
Create Date: 2026-10-03 13:48:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f8a7b9c0d1e3'
down_revision = "d8a7b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('schedule_slots', sa.Column('is_substitution', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('schedule_slots', 'is_substitution')
