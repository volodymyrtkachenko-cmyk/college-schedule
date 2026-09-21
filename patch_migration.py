import re

with open("backend/alembic/versions/a1f6b8ea04c9_add_curator_id_to_groups.py", "r") as f:
    text = f.read()

replacement = """def upgrade():
    conn = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(conn)
    col_names = [c["name"] for c in inspector.get_columns("groups")]
    if "curator_id" not in col_names:
        op.add_column('groups', sa.Column('curator_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_groups_teachers', 'groups', 'teachers', ['curator_id'], ['id'], ondelete='SET NULL')"""

text = re.sub(r'def upgrade\(\):\n\s*op.add_column.*?\n\s*op.create_foreign_key.*', replacement, text)

with open("backend/alembic/versions/a1f6b8ea04c9_add_curator_id_to_groups.py", "w") as f:
    f.write(text)
