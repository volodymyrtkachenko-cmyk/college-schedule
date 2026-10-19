"""Alter source_fingerprint to text

Revision ID: 20261019_source_fingerprint_text
Revises: 20261018_perf_composite_indexes
"""
from alembic import op
import sqlalchemy as sa

revision = "20261019_source_fingerprint_text"
down_revision = "20261018_perf_composite_indexes"
branch_labels = None
depends_on = None

def upgrade():
    op.alter_column(
        'schedule_publications',
        'source_fingerprint',
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True
    )

def downgrade():
    op.alter_column(
        'schedule_publications',
        'source_fingerprint',
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True
    )
