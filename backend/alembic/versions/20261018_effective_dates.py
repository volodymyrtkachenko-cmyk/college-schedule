"""Add effective date bounds to schedule and moved destination to overrides

Revision ID: 20261018_effective_dates
Revises: 20261016_classroom_roster
"""
from alembic import op
import sqlalchemy as sa

revision = "20261018_effective_dates"
down_revision = "20261016_classroom_roster"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        for stmt in [
            "ALTER TABLE schedule ADD COLUMN effective_from DATE",
            "ALTER TABLE schedule ADD COLUMN effective_until DATE",
            "ALTER TABLE schedule_override ADD COLUMN moved_to_date DATE",
            "ALTER TABLE schedule_override ADD COLUMN moved_to_lesson INTEGER",
        ]:
            try:
                op.execute(stmt)
            except Exception:
                pass
        op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_effective_from ON schedule (effective_from)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_effective_until ON schedule (effective_until)")
    else:
        op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'alembic_version' AND column_name = 'version_num'
                AND character_maximum_length < 64
            ) THEN
                ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'schedule' AND column_name = 'effective_from'
            ) THEN
                ALTER TABLE schedule ADD COLUMN effective_from DATE;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'schedule' AND column_name = 'effective_until'
            ) THEN
                ALTER TABLE schedule ADD COLUMN effective_until DATE;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'schedule_override' AND column_name = 'moved_to_date'
            ) THEN
                ALTER TABLE schedule_override ADD COLUMN moved_to_date DATE;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'schedule_override' AND column_name = 'moved_to_lesson'
            ) THEN
                ALTER TABLE schedule_override ADD COLUMN moved_to_lesson INTEGER;
            END IF;
        END $$;
        """)
        op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_effective_from ON schedule (effective_from)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_effective_until ON schedule (effective_until)")


def downgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    if not is_sqlite:
        op.execute("DROP INDEX IF EXISTS ix_schedule_effective_from")
        op.execute("DROP INDEX IF EXISTS ix_schedule_effective_until")
        op.execute("ALTER TABLE schedule DROP COLUMN IF EXISTS effective_from")
        op.execute("ALTER TABLE schedule DROP COLUMN IF EXISTS effective_until")
        op.execute("ALTER TABLE schedule_override DROP COLUMN IF EXISTS moved_to_date")
        op.execute("ALTER TABLE schedule_override DROP COLUMN IF EXISTS moved_to_lesson")
