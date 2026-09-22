"""Add user group access table

Revision ID: b3f8c9eb05d9
Revises: a2f7c9eb05d9
Create Date: 2026-09-22 19:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'b3f8c9eb05d9'
down_revision = 'a2f7c9eb05d9'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table('user_group_access',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('group_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['group_id'], ['groups.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'group_id')
    )

def downgrade() -> None:
    op.drop_table('user_group_access')
