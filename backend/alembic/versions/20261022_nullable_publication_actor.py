"""Make schedule_publications.actor_id nullable for background auto-import

Revision ID: 20261022_nullable_publication_actor
Revises: 20261021_classroom_credential_details
"""
from alembic import op
import sqlalchemy as sa

revision = "20261022_nullable_publication_actor"
down_revision = "20261021_classroom_credential_details"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("schedule_publications") as batch_op:
            batch_op.alter_column("actor_id", existing_type=sa.Integer(), nullable=True)
    else:
        op.execute("""
            ALTER TABLE schedule_publications ALTER COLUMN actor_id DROP NOT NULL;
            ALTER TABLE schedule_publications ADD COLUMN IF NOT EXISTS is_reverted BOOLEAN NOT NULL DEFAULT FALSE;
        """)


def downgrade():
    pass
