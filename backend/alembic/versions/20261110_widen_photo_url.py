"""Widen photo_url columns in classroom_credentials and group_students to TEXT

Revision ID: 20261110_widen_photo_url
Revises: 20261106_consolidate_indexes
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa

revision = "20261110_widen_photo_url"
down_revision = "20261106_consolidate_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else "postgresql"

    if dialect == "postgresql":
        op.execute("ALTER TABLE classroom_credentials ALTER COLUMN photo_url TYPE TEXT")
        op.execute("ALTER TABLE group_students ALTER COLUMN photo_url TYPE TEXT")


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else "postgresql"

    if dialect == "postgresql":
        op.execute(
            "ALTER TABLE classroom_credentials "
            "ALTER COLUMN photo_url TYPE VARCHAR(500) USING SUBSTRING(photo_url FROM 1 FOR 500)"
        )
        op.execute(
            "ALTER TABLE group_students "
            "ALTER COLUMN photo_url TYPE VARCHAR(500) USING SUBSTRING(photo_url FROM 1 FOR 500)"
        )
