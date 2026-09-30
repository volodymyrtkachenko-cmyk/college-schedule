"""add_lesson_number_check

Revision ID: 58f30034da92
Revises: 2f90a0d4edab
Create Date: 2026-09-30 08:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '58f30034da92'
down_revision: Union[str, None] = '2f90a0d4edab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Adding a CHECK constraint
    op.execute("ALTER TABLE schedule ADD CONSTRAINT chk_schedule_lesson_number CHECK (lesson_number BETWEEN 1 AND 4)")

def downgrade() -> None:
    op.execute("ALTER TABLE schedule DROP CONSTRAINT chk_schedule_lesson_number")
