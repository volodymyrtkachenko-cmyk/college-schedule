"""add scope updated_at

Revision ID: 20261008_add_scope_updated_at
Revises: 20261008_add_publications
Create Date: 2026-10-08 19:39:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import func

revision = '20261008_add_scope_updated_at'
down_revision = '20261008_add_publications'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('groups', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=func.now(), nullable=False))
    op.add_column('teachers', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=func.now(), nullable=False))

def downgrade() -> None:
    op.drop_column('teachers', 'updated_at')
    op.drop_column('groups', 'updated_at')
