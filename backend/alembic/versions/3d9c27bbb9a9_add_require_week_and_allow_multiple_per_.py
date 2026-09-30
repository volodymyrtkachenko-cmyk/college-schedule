"""Add require_week and allow_multiple_per_day to Curriculum

Revision ID: 3d9c27bbb9a9
Revises: f6385e8 ... Wait, let me just add the actual code.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3d9c27bbb9a9'
down_revision: Union[str, None] = 'ab0a673d18f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('curriculums', sa.Column('require_week', sa.String(255), nullable=True))
    op.add_column('curriculums', sa.Column('allow_multiple_per_day', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('curriculums', 'allow_multiple_per_day')
    op.drop_column('curriculums', 'require_week')
