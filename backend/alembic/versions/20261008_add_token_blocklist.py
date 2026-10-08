from alembic import op
import sqlalchemy as sa

revision = '20261008_add_token_blocklist'
down_revision = '20261008_drop_lesson_notes'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'token_blocklist',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('jti', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_token_blocklist_jti'), 'token_blocklist', ['jti'], unique=True)
    
    op.add_column('users', sa.Column('session_version', sa.Integer(), server_default='1', nullable=False))

def downgrade():
    op.drop_column('users', 'session_version')
    op.drop_index(op.f('ix_token_blocklist_jti'), table_name='token_blocklist')
    op.drop_table('token_blocklist')
