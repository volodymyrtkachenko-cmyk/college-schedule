"""Add dated notes/history, without rewriting the legacy destructive migration."""
from alembic import op
import sqlalchemy as sa

revision = "20261008_occurrence_notes"
down_revision = "20261008_add_token_blocklist"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("lesson_occurrence_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("note_date", sa.Date(), nullable=False),
        sa.Column("lesson_number", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("subject_name", sa.String(255), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("origin_kind", sa.String(30), nullable=False),
        sa.Column("origin_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("lesson_number BETWEEN 1 AND 4", name="ck_occurrence_note_slot"),
        sa.CheckConstraint("length(trim(note)) BETWEEN 1 AND 10000", name="ck_occurrence_note_text"),
        sa.CheckConstraint("revision > 0", name="ck_occurrence_note_revision"),
    )
    op.create_index("ix_lesson_occurrence_notes_group_id", "lesson_occurrence_notes", ["group_id"])
    op.create_index("ix_lesson_occurrence_notes_note_date", "lesson_occurrence_notes", ["note_date"])
    op.create_index("uq_occurrence_note_active", "lesson_occurrence_notes", ["group_id", "note_date", "lesson_number"],
        unique=True, postgresql_where=sa.text("archived = false"), sqlite_where=sa.text("archived = 0"))
    op.create_table("lesson_note_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("note_id", sa.Integer(), sa.ForeignKey("lesson_occurrence_notes.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("note_date", sa.Date(), nullable=False),
        sa.Column("lesson_number", sa.Integer(), nullable=False),
        sa.Column("event", sa.String(30), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("note_id", "revision", name="uq_note_revision"),
    )
    for col in ("note_id", "group_id", "note_date"):
        op.create_index("ix_lesson_note_revisions_"+col, "lesson_note_revisions", [col])


def downgrade():
    raise RuntimeError("Note history is protected: review/export before downgrade")
