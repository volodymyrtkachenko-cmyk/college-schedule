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
    conn = op.get_bind()
    insp = sa.inspect(conn)
    teacher_cols = [c["name"] for c in insp.get_columns("teachers")]
    if "full_name" not in teacher_cols:
        op.add_column("teachers", sa.Column("full_name", sa.String(150), nullable=True))
    if "email" not in teacher_cols:
        op.add_column("teachers", sa.Column("email", sa.String(255), nullable=True))

    tables = insp.get_table_names()
    if "group_students" not in tables:
        op.create_table(
            "group_students",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
            sa.Column("classroom_user_id", sa.String(64), nullable=False),
            sa.Column("full_name", sa.String(150), nullable=False),
            sa.Column("email", sa.String(150), nullable=True),
            sa.Column("photo_url", sa.String(500), nullable=True),
        )
        op.create_index("ix_group_students_id", "group_students", ["id"])
        op.create_index("ix_group_students_group_id", "group_students", ["group_id"])
        op.create_index("ix_group_students_classroom_user_id", "group_students", ["classroom_user_id"])

    if "classroom_group_bindings" not in tables:
        op.create_table(
            "classroom_group_bindings",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="CASCADE"), unique=True, nullable=False),
            sa.Column("course_id", sa.String(64), nullable=False),
            sa.Column("course_name", sa.String(200), nullable=False),
            sa.Column("refresh_token", sa.String(512), nullable=True),
            sa.Column("access_token", sa.String(512), nullable=True),
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        )
        op.create_index("ix_classroom_group_bindings_id", "classroom_group_bindings", ["id"])
        op.create_index("ix_classroom_group_bindings_group_id", "classroom_group_bindings", ["group_id"], unique=True)


def downgrade():
    op.drop_table("classroom_group_bindings")
    op.drop_table("group_students")
    op.drop_column("teachers", "full_name")
