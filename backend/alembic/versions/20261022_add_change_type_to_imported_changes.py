"""Add change_type column to imported_schedule_changes

Revision ID: 20261022_add_change_type
Revises: 20261022_nullable_publication_actor
"""
from alembic import op
import sqlalchemy as sa

revision = "20261022_add_change_type"
down_revision = "20261022_nullable_publication_actor"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("imported_schedule_changes") as batch_op:
            batch_op.add_column(sa.Column("change_type", sa.String(20), nullable=True, server_default="substitution"))
    else:
        op.execute("""
            ALTER TABLE imported_schedule_changes ADD COLUMN IF NOT EXISTS change_type VARCHAR(20) DEFAULT 'substitution';
        """)


def downgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("imported_schedule_changes") as batch_op:
            batch_op.drop_column("change_type")
    else:
        op.execute("ALTER TABLE imported_schedule_changes DROP COLUMN IF EXISTS change_type;")
