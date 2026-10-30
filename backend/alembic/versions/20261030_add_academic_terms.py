"""Add academic terms and link curriculums and teacher constraints to terms

Revision ID: 20261030_add_academic_terms
Revises: 20261030_fix_curator_hours
"""
from datetime import date
from alembic import op
import sqlalchemy as sa

revision = "20261030_add_academic_terms"
down_revision = "20261030_fix_curator_hours"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    # 1. Create academic_terms table
    op.create_table(
        "academic_terms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False, index=True),
        sa.Column("end_date", sa.Date(), nullable=False, index=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true" if not is_sqlite else "1")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("start_date < end_date", name="ck_academic_term_dates"),
        sa.CheckConstraint("length(trim(name)) > 0 AND length(name) <= 100", name="ck_academic_term_name"),
    )

    # 2. Get initial semester dates from settings or fallback defaults
    semester_start = "2026-09-01"
    semester_end = "2027-01-31"

    try:
        settings_res = bind.execute(sa.text("SELECT key, value FROM settings WHERE key IN ('semester_start', 'semester_end')")).fetchall()
        settings_dict = {row[0]: row[1] for row in settings_res}
        if "semester_start" in settings_dict and settings_dict["semester_start"]:
            semester_start = settings_dict["semester_start"]
        if "semester_end" in settings_dict and settings_dict["semester_end"]:
            semester_end = settings_dict["semester_end"]
    except Exception:
        pass

    # Insert default term
    academic_terms_table = sa.table(
        "academic_terms",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("start_date", sa.Date),
        sa.column("end_date", sa.Date),
        sa.column("is_active", sa.Boolean),
    )
    op.bulk_insert(
        academic_terms_table,
        [
            {
                "name": "2026/2027 · I семестр",
                "start_date": date.fromisoformat(semester_start),
                "end_date": date.fromisoformat(semester_end),
                "is_active": True,
            }
        ],
    )

    # Fetch inserted term id
    default_term_id = 1
    try:
        row = bind.execute(sa.text("SELECT id FROM academic_terms ORDER BY id ASC LIMIT 1")).fetchone()
        if row:
            default_term_id = row[0]
    except Exception:
        pass

    # 3. Add term_id column and update constraints
    if is_sqlite:
        with op.batch_alter_table("curriculums") as batch_op:
            batch_op.add_column(sa.Column("term_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_curriculums_term_id", "academic_terms", ["term_id"], ["id"], ondelete="CASCADE")
            batch_op.create_index("ix_curriculums_term_id", ["term_id"])
            batch_op.drop_constraint("uq_curriculum_assignment", type_="unique")
            batch_op.create_unique_constraint(
                "uq_curriculum_assignment",
                ["term_id", "group_id", "subject_id", "teacher_id", "second_teacher_id", "is_stream", "stream_id"]
            )

        with op.batch_alter_table("teacher_constraints") as batch_op:
            batch_op.add_column(sa.Column("term_id", sa.Integer(), nullable=True))
            batch_op.alter_column("lesson_number", existing_type=sa.Integer(), nullable=True)
            batch_op.create_foreign_key("fk_teacher_constraints_term_id", "academic_terms", ["term_id"], ["id"], ondelete="CASCADE")
            batch_op.create_index("ix_teacher_constraints_term_id", ["term_id"])
            batch_op.drop_constraint("uq_teacher_constraint_slot", type_="unique")
            batch_op.create_unique_constraint(
                "uq_teacher_constraint_slot",
                ["term_id", "teacher_id", "day_of_week", "lesson_number"]
            )
    else:
        op.execute(f"""
            ALTER TABLE curriculums ADD COLUMN IF NOT EXISTS term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE;
            CREATE INDEX IF NOT EXISTS ix_curriculums_term_id ON curriculums(term_id);
            UPDATE curriculums SET term_id = {default_term_id} WHERE term_id IS NULL;
            ALTER TABLE curriculums DROP CONSTRAINT IF EXISTS uq_curriculum_assignment;
            ALTER TABLE curriculums ADD CONSTRAINT uq_curriculum_assignment UNIQUE (term_id, group_id, subject_id, teacher_id, second_teacher_id, is_stream, stream_id);

            ALTER TABLE teacher_constraints ADD COLUMN IF NOT EXISTS term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE;
            ALTER TABLE teacher_constraints ALTER COLUMN lesson_number DROP NOT NULL;
            CREATE INDEX IF NOT EXISTS ix_teacher_constraints_term_id ON teacher_constraints(term_id);
            UPDATE teacher_constraints SET term_id = {default_term_id} WHERE term_id IS NULL;
            ALTER TABLE teacher_constraints DROP CONSTRAINT IF EXISTS uq_teacher_constraint_slot;
            ALTER TABLE teacher_constraints ADD CONSTRAINT uq_teacher_constraint_slot UNIQUE (term_id, teacher_id, day_of_week, lesson_number);
        """)


def downgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("curriculums") as batch_op:
            batch_op.drop_constraint("uq_curriculum_assignment", type_="unique")
            batch_op.create_unique_constraint(
                "uq_curriculum_assignment",
                ["group_id", "subject_id", "teacher_id", "second_teacher_id", "is_stream", "stream_id"]
            )
            batch_op.drop_column("term_id")

        with op.batch_alter_table("teacher_constraints") as batch_op:
            batch_op.drop_constraint("uq_teacher_constraint_slot", type_="unique")
            batch_op.create_unique_constraint(
                "uq_teacher_constraint_slot",
                ["teacher_id", "day_of_week", "lesson_number"]
            )
            batch_op.drop_column("term_id")
    else:
        op.execute("""
            ALTER TABLE curriculums DROP CONSTRAINT IF EXISTS uq_curriculum_assignment;
            ALTER TABLE curriculums ADD CONSTRAINT uq_curriculum_assignment UNIQUE (group_id, subject_id, teacher_id, second_teacher_id, is_stream, stream_id);
            ALTER TABLE curriculums DROP COLUMN IF EXISTS term_id;

            ALTER TABLE teacher_constraints DROP CONSTRAINT IF EXISTS uq_teacher_constraint_slot;
            ALTER TABLE teacher_constraints ADD CONSTRAINT uq_teacher_constraint_slot UNIQUE (teacher_id, day_of_week, lesson_number);
            ALTER TABLE teacher_constraints DROP COLUMN IF EXISTS term_id;
        """)

    op.drop_table("academic_terms")

