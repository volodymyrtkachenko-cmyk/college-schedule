"""Drop rooms and bind to teachers

Revision ID: drop_rooms_bind_to_teachers
Revises: None
Create Date: 2026-09-15 21:04:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'drop_rooms_bind_to_teachers'
down_revision: Union[str, None] = '8a5c8570ee1a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove foreign keys
    op.drop_constraint('schedule_room_id_fkey', 'schedule', type_='foreignkey')
    op.drop_constraint('teachers_room_id_fkey', 'teachers', type_='foreignkey')
    
    # Drop columns
    op.drop_column('schedule', 'room_id')
    op.drop_column('teachers', 'room_id')

    # Add room column to teachers
    op.add_column('teachers', sa.Column('room', sa.String(length=100), nullable=True))
    
    # Drop rooms table
    op.drop_table('rooms')


def downgrade() -> None:
    # We don't strictly need a perfect downgrade, but here it is
    op.create_table('rooms',
        sa.Column('id', sa.INTEGER(), autoincrement=True, nullable=False),
        sa.Column('name', sa.VARCHAR(length=100), autoincrement=False, nullable=False),
        sa.Column('building', sa.VARCHAR(length=100), autoincrement=False, nullable=True),
        sa.Column('capacity', sa.INTEGER(), autoincrement=False, nullable=True),
        sa.Column('is_active', sa.BOOLEAN(), autoincrement=False, nullable=False),
        sa.PrimaryKeyConstraint('id', name='rooms_pkey'),
        sa.UniqueConstraint('name', name='rooms_name_key')
    )
    op.drop_column('teachers', 'room')
    op.add_column('teachers', sa.Column('room_id', sa.INTEGER(), autoincrement=False, nullable=True))
    op.add_column('schedule', sa.Column('room_id', sa.INTEGER(), autoincrement=False, nullable=True))
    op.create_foreign_key('teachers_room_id_fkey', 'teachers', 'rooms', ['room_id'], ['id'])
    op.create_foreign_key('schedule_room_id_fkey', 'schedule', 'rooms', ['room_id'], ['id'])

