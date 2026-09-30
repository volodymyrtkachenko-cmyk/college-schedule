"""reset_admin_password

Revision ID: fd38b0122846
Revises: 64b1f4c7a52e
Create Date: 2026-09-30 07:54:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fd38b0122846'
down_revision: Union[str, None] = '64b1f4c7a52e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
