"""add_refactoring_models

Revision ID: 52a13cc41234
Revises: 27f545571025
Create Date: 2026-09-29 21:35:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

revision: str = '52a13cc41234'
down_revision: Union[str, None] = '27f545571025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. token_blocklist
    op.create_table(
        'token_blocklist',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('jti', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_token_blocklist_jti'), 'token_blocklist', ['jti'], unique=True)
    
    # 2. bell_schedule
    op.create_table(
        'bell_schedule',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('lesson_number', sa.Integer(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('end_time', sa.Time(), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bell_schedule_lesson_number'), 'bell_schedule', ['lesson_number'], unique=True)
    
    # Insert default bell schedule
    op.execute("""
        INSERT INTO bell_schedule (lesson_number, start_time, end_time, is_active) VALUES
        (1, '09:00', '10:20', true),
        (2, '10:40', '12:00', true),
        (3, '12:30', '13:50', true),
        (4, '14:00', '15:20', true)
    """)
    
    # 3. schedule_override
    op.create_table(
        'schedule_override',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('schedule_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=True),
        sa.Column('subject_id', sa.Integer(), nullable=True),
        sa.Column('room', sa.String(length=100), nullable=True),
        sa.Column('cancelled', sa.Boolean(), server_default='false', nullable=False),
        sa.ForeignKeyConstraint(['schedule_id'], ['schedule.id'], ),
        sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ),
        sa.ForeignKeyConstraint(['teacher_id'], ['teachers.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('schedule_id', 'date', name='uq_schedule_override_date')
    )
    op.create_index(op.f('ix_schedule_override_date'), 'schedule_override', ['date'], unique=False)
    op.create_index(op.f('ix_schedule_override_schedule_id'), 'schedule_override', ['schedule_id'], unique=False)
    
    # 4. schedule.room_override
    op.add_column('schedule', sa.Column('room_override', sa.String(length=100), nullable=True))

def downgrade() -> None:
    pass
