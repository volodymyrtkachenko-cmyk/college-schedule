"""Add classroom roster and group bindings

Revision ID: 20261016_classroom_roster
Revises: cec8f26bc555
"""
from alembic import op
import sqlalchemy as sa

revision = "20261016_classroom_roster"
down_revision = "cec8f26bc555"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        try:
            op.execute("ALTER TABLE teachers ADD COLUMN full_name VARCHAR(150)")
        except Exception:
            pass
        try:
            op.execute("ALTER TABLE teachers ADD COLUMN email VARCHAR(255)")
        except Exception:
            pass
        op.execute("""
        CREATE TABLE IF NOT EXISTS group_students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            classroom_user_id VARCHAR(64) NOT NULL,
            full_name VARCHAR(150) NOT NULL,
            email VARCHAR(150),
            photo_url VARCHAR(500)
        )
        """)
        op.execute("CREATE INDEX IF NOT EXISTS ix_group_students_group_id ON group_students (group_id)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_group_students_classroom_user_id ON group_students (classroom_user_id)")

        op.execute("""
        CREATE TABLE IF NOT EXISTS classroom_group_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
            course_id VARCHAR(64) NOT NULL,
            course_name VARCHAR(200) NOT NULL,
            refresh_token VARCHAR(512),
            access_token VARCHAR(512),
            last_synced_at TIMESTAMP,
            is_active BOOLEAN NOT NULL DEFAULT 1
        )
        """)
        op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_classroom_group_bindings_group_id ON classroom_group_bindings (group_id)")
    else:
        # PostgreSQL (Production on Fly.io)
        op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='teachers' AND column_name='full_name'
            ) THEN
                ALTER TABLE teachers ADD COLUMN full_name VARCHAR(150);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='teachers' AND column_name='email'
            ) THEN
                ALTER TABLE teachers ADD COLUMN email VARCHAR(255);
            END IF;
        END
        $$;

        CREATE TABLE IF NOT EXISTS group_students (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            classroom_user_id VARCHAR(64) NOT NULL,
            full_name VARCHAR(150) NOT NULL,
            email VARCHAR(150),
            photo_url VARCHAR(500)
        );

        CREATE INDEX IF NOT EXISTS ix_group_students_group_id ON group_students (group_id);
        CREATE INDEX IF NOT EXISTS ix_group_students_classroom_user_id ON group_students (classroom_user_id);

        CREATE TABLE IF NOT EXISTS classroom_group_bindings (
            id SERIAL PRIMARY KEY,
            group_id INTEGER NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
            course_id VARCHAR(64) NOT NULL,
            course_name VARCHAR(200) NOT NULL,
            refresh_token VARCHAR(512),
            access_token VARCHAR(512),
            last_synced_at TIMESTAMP WITH TIME ZONE,
            is_active BOOLEAN NOT NULL DEFAULT true
        );

        CREATE UNIQUE INDEX IF NOT EXISTS ix_classroom_group_bindings_group_id ON classroom_group_bindings (group_id);
        """)


def downgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        op.execute("DROP TABLE IF EXISTS classroom_group_bindings")
        op.execute("DROP TABLE IF EXISTS group_students")
    else:
        op.execute("""
        DROP TABLE IF EXISTS classroom_group_bindings CASCADE;
        DROP TABLE IF EXISTS group_students CASCADE;
        ALTER TABLE teachers DROP COLUMN IF EXISTS full_name;
        """)
