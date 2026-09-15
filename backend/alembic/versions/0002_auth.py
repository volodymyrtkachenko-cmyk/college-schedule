from alembic import op
import sqlalchemy as sa

revision = "0002_auth"
down_revision = "0001_initial"


def upgrade():
    op.add_column("users", sa.Column("username", sa.String(100), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("role", sa.String(20), nullable=False, server_default="viewer"))
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.execute("UPDATE users SET username = email WHERE username IS NULL AND email IS NOT NULL")


def downgrade():
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "role")
    op.drop_column("users", "password_hash")
    op.drop_column("users", "username")
