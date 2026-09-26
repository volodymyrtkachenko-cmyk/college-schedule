"""Add is_replacement to schedule

Revision ID: c4f9d0ec06ea
Revises: b3f8c9eb05d9
Create Date: 2026-09-26 20:10:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.schema import Sequence, CreateSequence

revision = 'c4f9d0ec06ea'
down_revision = 'b3f8c9eb05d9'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('schedule', sa.Column('is_replacement', sa.Boolean(), server_default='false', nullable=False))

def downgrade() -> None:
    op.drop_column('schedule', 'is_replacement')
