"""Add strict_day and strict_lesson to curriculums

Revision ID: 20261030_add_strict_fields
Revises: 20261030_add_publication_id
"""
from alembic import op
import sqlalchemy as sa


revision = "20261030_add_strict_fields"
down_revision = "20261030_add_publication_id"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("curriculums") as batch_op:
            batch_op.add_column(sa.Column("strict_day", sa.Integer(), nullable=True))
            batch_op.add_column(sa.Column("strict_lesson", sa.Integer(), nullable=True))
    else:
        op.execute(
            """
            ALTER TABLE curriculums
            ADD COLUMN IF NOT EXISTS strict_day INTEGER;
            ALTER TABLE curriculums
            ADD COLUMN IF NOT EXISTS strict_lesson INTEGER;
            """
        )


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("curriculums") as batch_op:
            batch_op.drop_column("strict_lesson")
            batch_op.drop_column("strict_day")
    else:
        op.execute(
            """
            ALTER TABLE curriculums
            DROP COLUMN IF EXISTS strict_lesson;
            ALTER TABLE curriculums
            DROP COLUMN IF EXISTS strict_day;
            """
        )
