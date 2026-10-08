"""Add revision to draft"""
revision = 'ce27ce1776ed'
down_revision = '1c4d574cc36e'

from alembic import op
import sqlalchemy as sa

def upgrade():
    op.add_column('schedule_drafts', sa.Column('revision', sa.Integer(), server_default='1', nullable=False))

def downgrade():
    op.drop_column('schedule_drafts', 'revision')
