"""${message}"""
revision = '${up_revision}'
down_revision = ${repr(down_revision)}
def upgrade():
    ${upgrades or "pass"}
def downgrade():
    ${downgrades or "pass"}
