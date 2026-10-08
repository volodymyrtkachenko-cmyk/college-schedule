"""add version exclusion

Revision ID: 20261008_add_version_exclusion
Revises: ce27ce1776ed
Create Date: 2026-10-08 19:25:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20261008_add_version_exclusion'
down_revision = 'ce27ce1776ed'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # We must ensure btree_gist extension exists
    op.execute('CREATE EXTENSION IF NOT EXISTS btree_gist')
    op.execute('''
        ALTER TABLE schedule_versions
        ADD CONSTRAINT excl_active_version_overlap
        EXCLUDE USING gist (
            daterange(valid_from, valid_until, '[]') WITH &&
        ) WHERE (is_active = true)
    ''')

def downgrade() -> None:
    op.execute('''
        ALTER TABLE schedule_versions
        DROP CONSTRAINT excl_active_version_overlap
    ''')
