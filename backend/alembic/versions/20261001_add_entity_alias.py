"""Add EntityAlias

Revision ID: d8a7b9c0d1e2
Revises: e19a4bd38c72
Create Date: 2026-10-01 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd8a7b9c0d1e2'
down_revision = "2a6c1d9e7b30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('entity_aliases',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('entity_type', sa.String(length=50), nullable=False),
    sa.Column('parsed_name', sa.String(length=255), nullable=False),
    sa.Column('actual_id', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('entity_type', 'parsed_name', name='uq_entity_alias_name')
    )
    op.create_index(op.f('ix_entity_aliases_entity_type'), 'entity_aliases', ['entity_type'], unique=False)
    op.create_index(op.f('ix_entity_aliases_parsed_name'), 'entity_aliases', ['parsed_name'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_entity_aliases_parsed_name'), table_name='entity_aliases')
    op.drop_index(op.f('ix_entity_aliases_entity_type'), table_name='entity_aliases')
    op.drop_table('entity_aliases')
