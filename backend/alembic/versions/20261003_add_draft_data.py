"""add draft data

Revision ID: b8b9c0d1e2f4
Revises: a8b9c0d1e2f3
Create Date: 2026-10-03 14:31:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b8b9c0d1e2f4'
down_revision = "a8b9c0d1e2f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('schedule_drafts', sa.Column('data', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('schedule_drafts', 'data')
