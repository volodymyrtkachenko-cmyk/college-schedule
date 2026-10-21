"""Add email, student_name, photo_url, subgroup to classroom_credentials

Revision ID: 20261021_classroom_credential_details
Revises: 20261021_classroom_credentials
"""
from alembic import op
import sqlalchemy as sa

revision = "20261021_classroom_credential_details"
down_revision = "20261021_classroom_credentials"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        columns = [
            ("email", "VARCHAR(150)"),
            ("student_name", "VARCHAR(150)"),
            ("photo_url", "VARCHAR(500)"),
            ("subgroup", "INTEGER"),
        ]
        for col_name, col_type in columns:
            try:
                op.execute(f"ALTER TABLE classroom_credentials ADD COLUMN {col_name} {col_type}")
            except Exception:
                pass
    else:
        op.execute("""
            ALTER TABLE classroom_credentials ADD COLUMN IF NOT EXISTS email VARCHAR(150);
            ALTER TABLE classroom_credentials ADD COLUMN IF NOT EXISTS student_name VARCHAR(150);
            ALTER TABLE classroom_credentials ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500);
            ALTER TABLE classroom_credentials ADD COLUMN IF NOT EXISTS subgroup INTEGER;
        """)


def downgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    if not is_sqlite:
        op.execute("""
            ALTER TABLE classroom_credentials DROP COLUMN IF EXISTS email;
            ALTER TABLE classroom_credentials DROP COLUMN IF EXISTS student_name;
            ALTER TABLE classroom_credentials DROP COLUMN IF EXISTS photo_url;
            ALTER TABLE classroom_credentials DROP COLUMN IF EXISTS subgroup;
        """)
