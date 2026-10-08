from alembic import op
import sqlalchemy as sa

revision = '20261008_add_token_blocklist'
down_revision = '20261008_drop_lesson_notes'
branch_labels = None
depends_on = None

def upgrade():
    op.execute("""
    CREATE TABLE IF NOT EXISTS token_blocklist (
        id SERIAL PRIMARY KEY,
        jti VARCHAR NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ix_token_blocklist_jti ON token_blocklist (jti);
    """)
    op.execute("""
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='users' AND column_name='session_version') THEN
            ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 1 NOT NULL;
        END IF;
    END
    $$;
    """)

def downgrade():
    op.drop_column('users', 'session_version')
    op.drop_index(op.f('ix_token_blocklist_jti'), table_name='token_blocklist')
    op.drop_table('token_blocklist')
