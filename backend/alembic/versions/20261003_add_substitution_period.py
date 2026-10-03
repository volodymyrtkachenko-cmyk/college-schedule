"""add substitution period and source

Revision ID: a8b9c0d1e2f3
Revises: f8a7b9c0d1e3
Create Date: 2026-10-03 14:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a8b9c0d1e2f3'
down_revision = "f8a7b9c0d1e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Update check constraint
    op.execute("ALTER TABLE schedule_periods DROP CONSTRAINT ck_schedule_period_type")
    op.execute("ALTER TABLE schedule_periods ADD CONSTRAINT ck_schedule_period_type CHECK (period_type IN ('practice', 'holiday', 'substitution'))")
    
    # Add source
    op.add_column('schedule_period_slots', sa.Column('source', sa.String(length=50), server_default='manual', nullable=False))


def downgrade() -> None:
    op.drop_column('schedule_period_slots', 'source')
    op.execute("ALTER TABLE schedule_periods DROP CONSTRAINT ck_schedule_period_type")
    op.execute("ALTER TABLE schedule_periods ADD CONSTRAINT ck_schedule_period_type CHECK (period_type IN ('practice', 'holiday'))")
