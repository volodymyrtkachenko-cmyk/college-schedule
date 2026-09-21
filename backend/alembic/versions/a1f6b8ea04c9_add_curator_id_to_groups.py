"""add curator_id to groups"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision = 'a1f6b8ea04c9'
down_revision = 'drop_rooms_bind_to_teachers'
branch_labels = None
depends_on = None

def upgrade():
    conn = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(conn)
    col_names = [c["name"] for c in inspector.get_columns("groups")]
    if "curator_id" not in col_names:
        op.add_column('groups', sa.Column('curator_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_groups_teachers', 'groups', 'teachers', ['curator_id'], ['id'], ondelete='SET NULL')

def downgrade():
    op.drop_constraint('fk_groups_teachers', 'groups', type_='foreignkey')
    op.drop_column('groups', 'curator_id')
