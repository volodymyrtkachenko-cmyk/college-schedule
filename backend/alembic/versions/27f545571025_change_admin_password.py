"""change_admin_password

Revision ID: 27f545571025
Revises: c4f9d0ec06ea
Create Date: 2026-09-29 21:30:01.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from app.core.security import hash_password

revision: str = '27f545571025'
down_revision: Union[str, None] = 'c4f9d0ec06ea'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
