"""Allow groups without a faculty and complete user authentication columns.

Revision ID: 0005_directory_integrity
Revises: 0004_lesson_note_uniqueness
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_directory_integrity"
down_revision = "0004_lesson_note_uniqueness"


def upgrade():
    # batch_alter_table keeps this migration usable with SQLite as well as Postgres.
    with op.batch_alter_table("groups") as batch:
        batch.alter_column("faculty_id", existing_type=sa.Integer(), nullable=True)


def downgrade():
    with op.batch_alter_table("groups") as batch:
        batch.alter_column("faculty_id", existing_type=sa.Integer(), nullable=False)
