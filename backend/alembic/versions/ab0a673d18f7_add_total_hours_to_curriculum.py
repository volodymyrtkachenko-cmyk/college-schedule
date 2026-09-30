"""add_total_hours_to_curriculum

Revision ID: ab0a673d18f7
Revises: b9085a62343a
Create Date: 2026-09-30 19:48:33.454224

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'ab0a673d18f7'
down_revision: Union[str, None] = 'b9085a62343a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('curriculums', sa.Column('total_hours', sa.Integer(), server_default='0', nullable=False))

def downgrade() -> None:
    op.drop_column('curriculums', 'total_hours')
