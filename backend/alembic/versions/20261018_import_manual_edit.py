"""Add manually_edited flag to imported_schedule_changes

Revision ID: 20261018_import_manual_edit
Revises: 20261018_effective_dates
"""
from alembic import op
import sqlalchemy as sa

revision = "20261018_import_manual_edit"
down_revision = "20261018_effective_dates"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        try:
            op.execute("ALTER TABLE imported_schedule_changes ADD COLUMN manually_edited BOOLEAN DEFAULT 0 NOT NULL")
        except Exception:
            pass
        op.execute("CREATE INDEX IF NOT EXISTS ix_imported_schedule_changes_manually_edited ON imported_schedule_changes (manually_edited)")
    else:
        op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'imported_schedule_changes' AND column_name = 'manually_edited'
            ) THEN
                ALTER TABLE imported_schedule_changes ADD COLUMN manually_edited BOOLEAN DEFAULT FALSE NOT NULL;
            END IF;
        END $$;
        """)
        op.execute("CREATE INDEX IF NOT EXISTS ix_imported_schedule_changes_manually_edited ON imported_schedule_changes (manually_edited)")


def downgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    if not is_sqlite:
        op.execute("DROP INDEX IF EXISTS ix_imported_schedule_changes_manually_edited")
        op.execute("ALTER TABLE imported_schedule_changes DROP COLUMN IF EXISTS manually_edited")
