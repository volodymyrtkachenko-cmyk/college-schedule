"""Add publication_id column to imported_schedule_changes

Revision ID: 20261030_add_publication_id
Revises: 20261029_dedup_curriculums
"""
from alembic import op
import sqlalchemy as sa

revision = "20261030_add_publication_id"
down_revision = "20261029_dedup_curriculums"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("imported_schedule_changes") as batch_op:
            batch_op.add_column(sa.Column("publication_id", sa.Integer(), nullable=True))
    else:
        op.execute(
            """
            ALTER TABLE imported_schedule_changes
            ADD COLUMN IF NOT EXISTS publication_id INTEGER REFERENCES schedule_publications(id) ON DELETE CASCADE;
            """
        )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_imported_schedule_changes_publication_id ON imported_schedule_changes (publication_id)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_imported_schedule_changes_publication_id")
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("imported_schedule_changes") as batch_op:
            batch_op.drop_column("publication_id")
    else:
        op.execute("ALTER TABLE imported_schedule_changes DROP COLUMN IF EXISTS publication_id;")
