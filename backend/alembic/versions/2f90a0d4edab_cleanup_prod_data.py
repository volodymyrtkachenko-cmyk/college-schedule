"""cleanup_prod_data

Revision ID: 2f90a0d4edab
Revises: fd38b0122846
Create Date: 2026-09-30 08:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f90a0d4edab'
down_revision: Union[str, None] = 'fd38b0122846'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
