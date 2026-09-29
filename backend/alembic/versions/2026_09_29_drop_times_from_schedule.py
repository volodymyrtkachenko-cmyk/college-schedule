"""drop_times_from_schedule

Revision ID: 64b1f4c7a52e
Revises: 52a13cc41234
Create Date: 2026-09-29 21:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

revision: str = '64b1f4c7a52e'
down_revision: Union[str, None] = '52a13cc41234'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Safely drop the duplicate columns from Schedule that are now in bell_schedule
    op.drop_column('schedule', 'start_time')
    op.drop_column('schedule', 'end_time')

def downgrade() -> None:
    pass
