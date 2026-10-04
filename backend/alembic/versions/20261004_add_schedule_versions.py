"""Add schedule versions

Revision ID: 20261004_add_schedule_versions
Revises: 20261004_expand_schedule_periods
Create Date: 2026-10-04 21:12:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20261004_add_schedule_versions'
down_revision = '20261004_expand_schedule_periods'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create schedule_versions table
    op.create_table(
        'schedule_versions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('valid_from', sa.Date(), nullable=False),
        sa.Column('valid_until', sa.Date(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_schedule_versions_valid_from'), 'schedule_versions', ['valid_from'], unique=False)
    op.create_index(op.f('ix_schedule_versions_valid_until'), 'schedule_versions', ['valid_until'], unique=False)

    # 2. Add version_id to schedule table
    op.add_column('schedule', sa.Column('version_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_schedule_version_id'), 'schedule', ['version_id'], unique=False)
    op.create_foreign_key('fk_schedule_version_id', 'schedule', 'schedule_versions', ['version_id'], ['id'], ondelete='CASCADE')

def downgrade():
    op.drop_constraint('fk_schedule_version_id', 'schedule', type_='foreignkey')
    op.drop_index(op.f('ix_schedule_version_id'), table_name='schedule')
    op.drop_column('schedule', 'version_id')
    op.drop_index(op.f('ix_schedule_versions_valid_until'), table_name='schedule_versions')
    op.drop_index(op.f('ix_schedule_versions_valid_from'), table_name='schedule_versions')
    op.drop_table('schedule_versions')
