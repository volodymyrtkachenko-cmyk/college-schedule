"""Add classroom_credentials table and migrate legacy tokens

Revision ID: 20261021_classroom_credentials
Revises: 20261019_source_fingerprint_text
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

from app.core.crypto import encrypt_token

revision = "20261021_classroom_credentials"
down_revision = "20261019_source_fingerprint_text"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        op.execute("""
        CREATE TABLE IF NOT EXISTS classroom_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            google_user_id VARCHAR(128) NOT NULL,
            refresh_token TEXT,
            last_synced_at TIMESTAMP,
            last_error TEXT,
            fail_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TIMESTAMP,
            is_active BOOLEAN NOT NULL DEFAULT 1,
            CONSTRAINT uq_classroom_cred_group_user UNIQUE (group_id, google_user_id)
        )
        """)
        op.execute("CREATE INDEX IF NOT EXISTS ix_classroom_credentials_group_id ON classroom_credentials (group_id)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_classroom_credentials_google_user_id ON classroom_credentials (google_user_id)")
    else:
        op.execute("""
        CREATE TABLE IF NOT EXISTS classroom_credentials (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            google_user_id VARCHAR(128) NOT NULL,
            refresh_token TEXT,
            last_synced_at TIMESTAMP WITH TIME ZONE,
            last_error TEXT,
            fail_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TIMESTAMP WITH TIME ZONE,
            is_active BOOLEAN NOT NULL DEFAULT true,
            CONSTRAINT uq_classroom_cred_group_user UNIQUE (group_id, google_user_id)
        );
        CREATE INDEX IF NOT EXISTS ix_classroom_credentials_group_id ON classroom_credentials (group_id);
        CREATE INDEX IF NOT EXISTS ix_classroom_credentials_google_user_id ON classroom_credentials (google_user_id);
        """)

    # Migrate existing refresh_token entries from classroom_group_bindings
    try:
        rows = bind.execute(
            text(
                "SELECT group_id, refresh_token, last_synced_at, is_active "
                "FROM classroom_group_bindings "
                "WHERE refresh_token IS NOT NULL AND trim(refresh_token) != ''"
            )
        ).fetchall()

        for row in rows:
            group_id, raw_refresh, last_synced_at, is_active = row[0], row[1], row[2], row[3]
            encrypted_tok = encrypt_token(raw_refresh)
            legacy_uid = f"legacy_group_{group_id}"

            exists = bind.execute(
                text(
                    "SELECT 1 FROM classroom_credentials "
                    "WHERE group_id = :gid AND google_user_id = :uid"
                ),
                {"gid": group_id, "uid": legacy_uid},
            ).first()

            if not exists:
                bind.execute(
                    text(
                        "INSERT INTO classroom_credentials "
                        "(group_id, google_user_id, refresh_token, last_synced_at, fail_count, is_active) "
                        "VALUES (:gid, :uid, :rt, :synced, 0, :active)"
                    ),
                    {
                        "gid": group_id,
                        "uid": legacy_uid,
                        "rt": encrypted_tok,
                        "synced": last_synced_at,
                        "active": bool(is_active),
                    },
                )
    except Exception:
        pass


def downgrade():
    # Old table classroom_group_bindings is preserved untouched; drop only the new table if rolled back.
    op.execute("DROP TABLE IF EXISTS classroom_credentials")
