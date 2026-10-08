"""add publications

Revision ID: 20261008_add_publications
Revises: 20261008_add_version_exclusion
Create Date: 2026-10-08 19:29:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20261008_add_publications'
down_revision = '20261008_add_version_exclusion'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table('schedule_publications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('version_id', sa.Integer(), nullable=True),
        sa.Column('actor_id', sa.Integer(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('scope_manifest', sa.Text(), nullable=False),
        sa.Column('source_fingerprint', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['version_id'], ['schedule_versions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_schedule_publications_version_id'), 'schedule_publications', ['version_id'], unique=False)
    
    op.create_table('schedule_publication_snapshots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('publication_id', sa.Integer(), nullable=False),
        sa.Column('group_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=True),
        sa.Column('lesson_number', sa.Integer(), nullable=True),
        sa.Column('before_data', sa.Text(), nullable=True),
        sa.Column('after_data', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['group_id'], ['groups.id'], ),
        sa.ForeignKeyConstraint(['publication_id'], ['schedule_publications.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_schedule_publication_snapshots_group_id'), 'schedule_publication_snapshots', ['group_id'], unique=False)
    op.create_index(op.f('ix_schedule_publication_snapshots_publication_id'), 'schedule_publication_snapshots', ['publication_id'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_schedule_publication_snapshots_publication_id'), table_name='schedule_publication_snapshots')
    op.drop_index(op.f('ix_schedule_publication_snapshots_group_id'), table_name='schedule_publication_snapshots')
    op.drop_table('schedule_publication_snapshots')
    op.drop_index(op.f('ix_schedule_publications_version_id'), table_name='schedule_publications')
    op.drop_table('schedule_publications')
