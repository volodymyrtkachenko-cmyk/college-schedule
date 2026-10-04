"""expand schedule periods and add year_of_admission

Revision ID: 20261004_01
Revises: c9d0e1f2a3b4
Create Date: 2026-10-04 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20261004_01'
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add year_of_admission
    op.add_column('groups', sa.Column('year_of_admission', sa.Integer(), nullable=True))

    # Update check constraint
    op.execute("ALTER TABLE schedule_periods DROP CONSTRAINT ck_schedule_period_type")
    op.execute("ALTER TABLE schedule_periods ADD CONSTRAINT ck_schedule_period_type CHECK (period_type IN ('theory', 'session', 'practice', 'holiday', 'diploma', 'attestation'))")
    

def downgrade() -> None:
    op.execute("ALTER TABLE schedule_periods DROP CONSTRAINT ck_schedule_period_type")
    op.execute("ALTER TABLE schedule_periods ADD CONSTRAINT ck_schedule_period_type CHECK (period_type IN ('practice', 'holiday'))")
    op.drop_column('groups', 'year_of_admission')
