"""actually_create_schedule_tables

Revision ID: b9085a62343a
Revises: 8590cde2a8c2
Create Date: 2026-09-30 19:30:04.283193

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9085a62343a'
down_revision: Union[str, None] = '8590cde2a8c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('curriculums',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('group_id', sa.Integer(), nullable=False),
    sa.Column('subject_id', sa.Integer(), nullable=False),
    sa.Column('teacher_id', sa.Integer(), nullable=False),
    sa.Column('second_teacher_id', sa.Integer(), nullable=True),
    sa.Column('pairs_per_2_weeks', sa.Integer(), nullable=False),
    sa.Column('is_stream', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('stream_id', sa.String(length=100), nullable=True),
    sa.Column('is_fixed', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.ForeignKeyConstraint(['group_id'], ['groups.id'], ),
    sa.ForeignKeyConstraint(['second_teacher_id'], ['teachers.id'], ),
    sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ),
    sa.ForeignKeyConstraint(['teacher_id'], ['teachers.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_curriculums_group_id'), 'curriculums', ['group_id'], unique=False)

    op.create_table('teacher_constraints',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('teacher_id', sa.Integer(), nullable=False),
    sa.Column('day_of_week', sa.Integer(), nullable=False),
    sa.Column('lesson_number', sa.Integer(), nullable=False),
    sa.Column('is_hard_constraint', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.ForeignKeyConstraint(['teacher_id'], ['teachers.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_teacher_constraints_teacher_id'), 'teacher_constraints', ['teacher_id'], unique=False)

    op.create_table('schedule_drafts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=20), server_default="'draft'", nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )

    op.create_table('schedule_slots',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('draft_id', sa.Integer(), nullable=False),
    sa.Column('curriculum_id', sa.Integer(), nullable=False),
    sa.Column('day_of_week', sa.Integer(), nullable=False),
    sa.Column('lesson_number', sa.Integer(), nullable=False),
    sa.Column('week_type', sa.String(length=20), server_default="'both'", nullable=False),
    sa.Column('room_override', sa.String(length=100), nullable=True),
    sa.ForeignKeyConstraint(['curriculum_id'], ['curriculums.id'], ),
    sa.ForeignKeyConstraint(['draft_id'], ['schedule_drafts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_schedule_slots_curriculum_id'), 'schedule_slots', ['curriculum_id'], unique=False)
    op.create_index(op.f('ix_schedule_slots_draft_id'), 'schedule_slots', ['draft_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_schedule_slots_draft_id'), table_name='schedule_slots')
    op.drop_index(op.f('ix_schedule_slots_curriculum_id'), table_name='schedule_slots')
    op.drop_table('schedule_slots')
    op.drop_table('schedule_drafts')
    op.drop_index(op.f('ix_teacher_constraints_teacher_id'), table_name='teacher_constraints')
    op.drop_table('teacher_constraints')
    op.drop_index(op.f('ix_curriculums_group_id'), table_name='curriculums')
    op.drop_table('curriculums')
