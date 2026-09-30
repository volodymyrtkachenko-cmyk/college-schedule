"""drop_times_from_schedule

Revision ID: 64b1f4c7a52e
Revises: 52a13cc41234
Create Date: 2026-09-29 21:50:00.000000

Times now live in bell_schedule. Idempotent: skips columns that are already gone.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '64b1f4c7a52e'
down_revision: Union[str, None] = '52a13cc41234'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns('schedule')}
    for col in ('start_time', 'end_time'):
        if col in existing:
            op.drop_column('schedule', col)


def downgrade() -> None:
    pass
