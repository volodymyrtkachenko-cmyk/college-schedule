"""Add needs_relink, last_refresh_ok_at, last_client_seen_at, granted_scopes to classroom_credentials

Revision ID: 20261110_classroom_relink_fields
Revises: 20261110_widen_photo_url
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa

revision = "20261110_classroom_relink_fields"
down_revision = "20261110_widen_photo_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add new columns
    op.add_column(
        "classroom_credentials",
        sa.Column("needs_relink", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "classroom_credentials",
        sa.Column("last_refresh_ok_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "classroom_credentials",
        sa.Column("last_client_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "classroom_credentials",
        sa.Column("granted_scopes", sa.Text(), nullable=True),
    )

    # 2. Data migration: Initialize last_client_seen_at from last_synced_at
    op.execute(
        "UPDATE classroom_credentials SET last_client_seen_at = last_synced_at WHERE last_synced_at IS NOT NULL"
    )

    # 3. Flag dead/undecryptable tokens immediately so users see relink banner and background loop skips them
    op.execute(
        """
        UPDATE classroom_credentials
        SET needs_relink = true,
            is_active = false,
            last_error = CASE
                WHEN last_error IS NOT NULL AND trim(last_error) != '' THEN last_error
                ELSE 'needs_relink: missing_or_corrupt_refresh_token'
            END
        WHERE refresh_token IS NULL
           OR trim(refresh_token) = ''
           OR refresh_token LIKE 'ya29.%'
           OR last_error LIKE '%missing_or_corrupt_refresh_token%'
           OR last_error LIKE '%invalid_grant%'
        """
    )


def downgrade() -> None:
    op.drop_column("classroom_credentials", "granted_scopes")
    op.drop_column("classroom_credentials", "last_client_seen_at")
    op.drop_column("classroom_credentials", "last_refresh_ok_at")
    op.drop_column("classroom_credentials", "needs_relink")
