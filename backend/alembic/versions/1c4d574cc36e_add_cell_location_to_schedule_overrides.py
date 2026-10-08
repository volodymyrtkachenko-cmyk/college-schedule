"""Add cell location to schedule overrides"""
revision = '1c4d574cc36e'
down_revision = '20261008_occurrence_notes'

from alembic import op
import sqlalchemy as sa

def upgrade():
    # 1. Add columns (nullable for now to allow backfill)
    op.add_column('schedule_override', sa.Column('group_id', sa.Integer(), nullable=True))
    op.add_column('schedule_override', sa.Column('lesson_number', sa.Integer(), nullable=True))
    op.add_column('schedule_override', sa.Column('second_teacher_id', sa.Integer(), nullable=True))
    op.add_column('schedule_override', sa.Column('stream_id', sa.String(length=100), nullable=True))
    
    # 2. Add foreign keys and indexes
    op.create_foreign_key('fk_schedule_override_group_id', 'schedule_override', 'groups', ['group_id'], ['id'])
    op.create_foreign_key('fk_schedule_override_second_teacher_id', 'schedule_override', 'teachers', ['second_teacher_id'], ['id'])
    op.create_index(op.f('ix_schedule_override_group_id'), 'schedule_override', ['group_id'], unique=False)
    
    # 3. Backfill data from `schedule` table
    op.execute('''
        UPDATE schedule_override 
        SET group_id = s.group_id, 
            lesson_number = s.lesson_number,
            second_teacher_id = s.second_teacher_id,
            stream_id = s.stream_id
        FROM schedule s 
        WHERE schedule_override.schedule_id = s.id
    ''')
    
    # 4. Alter schedule_id to be nullable
    op.alter_column('schedule_override', 'schedule_id',
               existing_type=sa.Integer(),
               nullable=True)
               
    # 5. Drop old unique constraint
    op.drop_constraint('uq_schedule_override_date', 'schedule_override', type_='unique')
    
    # 6. Delete invalid rows if any (those without group_id/lesson_number now, though backfill should have caught them)
    op.execute('DELETE FROM schedule_override WHERE group_id IS NULL OR lesson_number IS NULL')
    
    # 7. Alter group_id and lesson_number to be non-nullable
    op.alter_column('schedule_override', 'group_id',
               existing_type=sa.Integer(),
               nullable=False)
    op.alter_column('schedule_override', 'lesson_number',
               existing_type=sa.Integer(),
               nullable=False)
               
    # 8. Add new unique constraint
    op.create_unique_constraint('uq_schedule_override_cell', 'schedule_override', ['group_id', 'date', 'lesson_number'])


def downgrade():
    op.drop_constraint('uq_schedule_override_cell', 'schedule_override', type_='unique')
    op.alter_column('schedule_override', 'schedule_id',
               existing_type=sa.Integer(),
               nullable=False)
    op.create_unique_constraint('uq_schedule_override_date', 'schedule_override', ['schedule_id', 'date'])
    
    op.drop_index(op.f('ix_schedule_override_group_id'), table_name='schedule_override')
    op.drop_constraint('fk_schedule_override_group_id', 'schedule_override', type_='foreignkey')
    op.drop_constraint('fk_schedule_override_second_teacher_id', 'schedule_override', type_='foreignkey')
    
    op.drop_column('schedule_override', 'stream_id')
    op.drop_column('schedule_override', 'second_teacher_id')
    op.drop_column('schedule_override', 'lesson_number')
    op.drop_column('schedule_override', 'group_id')
