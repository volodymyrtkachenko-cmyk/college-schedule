"""Add academic terms and course schedules with term isolation

Revision ID: 20261102_academic_terms
Revises: f1a2b3c4d5e6
"""
from datetime import date
from alembic import op
import sqlalchemy as sa

revision = "20261102_academic_terms"
down_revision = "f1a2b3c4d5e6"
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
        sa.Column("academic_year", sa.String(20), nullable=False, server_default="2025/2026"),
        sa.Column("semester_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("start_date", sa.Date(), nullable=False, index=True),
        sa.Column("end_date", sa.Date(), nullable=False, index=True),
        sa.Column("total_weeks", sa.Integer(), nullable=False, server_default="17"),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("true" if not is_sqlite else "1")),
        sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("start_date < end_date", name="ck_academic_term_dates"),
        sa.CheckConstraint("length(trim(name)) > 0 AND length(name) <= 100", name="ck_academic_term_name"),
    )
    op.create_index("ix_academic_terms_is_current", "academic_terms", ["is_current"])

    # 2. Create term_course_schedules table
    op.create_table(
        "term_course_schedules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("term_id", sa.Integer(), sa.ForeignKey("academic_terms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("course", sa.Integer(), nullable=False),
        sa.Column("total_weeks", sa.Integer(), nullable=False, server_default="17"),
        sa.Column("practice_weeks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("practice_timing", sa.String(20), nullable=False, server_default="NONE"),
        sa.Column("practice_start_week", sa.Integer(), nullable=True),
        sa.Column("practice_end_week", sa.Integer(), nullable=True),
        sa.Column("theory_weeks", sa.Integer(), nullable=False, server_default="17"),
        sa.UniqueConstraint("term_id", "course", name="uq_term_course_schedule"),
        sa.CheckConstraint("course BETWEEN 1 AND 4", name="ck_term_course_schedule_course"),
        sa.CheckConstraint("practice_weeks >= 0 AND practice_weeks <= total_weeks", name="ck_term_course_schedule_practice"),
    )

    # 3. Read semester dates from settings or fallback defaults
    semester_start = "2025-09-01"
    semester_end = "2026-01-31"

    try:
        settings_res = bind.execute(sa.text("SELECT key, value FROM settings WHERE key IN ('semester_start', 'semester_end')")).fetchall()
        settings_dict = {row[0]: row[1] for row in settings_res}
        if "semester_start" in settings_dict and settings_dict["semester_start"]:
            semester_start = settings_dict["semester_start"]
        if "semester_end" in settings_dict and settings_dict["semester_end"]:
            semester_end = settings_dict["semester_end"]
    except Exception:
        pass

    # 4. Insert active term
    academic_terms_table = sa.table(
        "academic_terms",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("academic_year", sa.String),
        sa.column("semester_number", sa.Integer),
        sa.column("start_date", sa.Date),
        sa.column("end_date", sa.Date),
        sa.column("total_weeks", sa.Integer),
        sa.column("is_current", sa.Boolean),
        sa.column("status", sa.String),
    )
    op.bulk_insert(
        academic_terms_table,
        [
            {
                "name": "2025/2026 · I семестр",
                "academic_year": "2025/2026",
                "semester_number": 1,
                "start_date": date.fromisoformat(semester_start),
                "end_date": date.fromisoformat(semester_end),
                "total_weeks": 17,
                "is_current": True,
                "status": "ACTIVE",
            }
        ],
    )

    # Fetch inserted active term id
    default_term_id = 1
    try:
        row = bind.execute(sa.text("SELECT id FROM academic_terms WHERE is_current = true LIMIT 1" if not is_sqlite else "SELECT id FROM academic_terms WHERE is_current = 1 LIMIT 1")).fetchone()
        if row:
            default_term_id = row[0]
    except Exception:
        pass

    # 5. Insert course schedules for courses 1..4
    term_course_schedules_table = sa.table(
        "term_course_schedules",
        sa.column("term_id", sa.Integer),
        sa.column("course", sa.Integer),
        sa.column("total_weeks", sa.Integer),
        sa.column("practice_weeks", sa.Integer),
        sa.column("practice_timing", sa.String),
        sa.column("practice_start_week", sa.Integer),
        sa.column("practice_end_week", sa.Integer),
        sa.column("theory_weeks", sa.Integer),
    )
    op.bulk_insert(
        term_course_schedules_table,
        [
            {"term_id": default_term_id, "course": 1, "total_weeks": 17, "practice_weeks": 0, "practice_timing": "NONE", "practice_start_week": None, "practice_end_week": None, "theory_weeks": 17},
            {"term_id": default_term_id, "course": 2, "total_weeks": 17, "practice_weeks": 0, "practice_timing": "NONE", "practice_start_week": None, "practice_end_week": None, "theory_weeks": 17},
            {"term_id": default_term_id, "course": 3, "total_weeks": 17, "practice_weeks": 2, "practice_timing": "MIDDLE", "practice_start_week": 8, "practice_end_week": 9, "theory_weeks": 15},
            {"term_id": default_term_id, "course": 4, "total_weeks": 17, "practice_weeks": 3, "practice_timing": "MIDDLE", "practice_start_week": 8, "practice_end_week": 10, "theory_weeks": 14},
        ],
    )

    # 6. Add term_id to curriculums, teacher_constraints, and schedule_drafts
    if is_sqlite:
        with op.batch_alter_table("curriculums") as batch_op:
            batch_op.add_column(sa.Column("term_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_curriculums_term_id", "academic_terms", ["term_id"], ["id"], ondelete="CASCADE")
            batch_op.create_index("ix_curriculums_term_id", ["term_id"])
            batch_op.drop_constraint("uq_curriculum_assignment", type_="unique")
            batch_op.create_unique_constraint(
                "uq_curriculum_assignment",
                ["term_id", "group_id", "subject_id", "teacher_id", "second_teacher_id", "is_stream", "stream_id"],
            )

        with op.batch_alter_table("teacher_constraints") as batch_op:
            batch_op.add_column(sa.Column("term_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_teacher_constraints_term_id", "academic_terms", ["term_id"], ["id"], ondelete="CASCADE")
            batch_op.create_index("ix_teacher_constraints_term_id", ["term_id"])
            batch_op.drop_constraint("uq_teacher_constraint_slot", type_="unique")
            batch_op.create_unique_constraint(
                "uq_teacher_constraint_slot",
                ["term_id", "teacher_id", "day_of_week", "lesson_number"],
            )

        with op.batch_alter_table("schedule_drafts") as batch_op:
            batch_op.add_column(sa.Column("term_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_schedule_drafts_term_id", "academic_terms", ["term_id"], ["id"], ondelete="SET NULL")
            batch_op.create_index("ix_schedule_drafts_term_id", ["term_id"])
    else:
        op.execute(f"""
            ALTER TABLE curriculums ADD COLUMN IF NOT EXISTS term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE;
            CREATE INDEX IF NOT EXISTS ix_curriculums_term_id ON curriculums(term_id);
            UPDATE curriculums SET term_id = {default_term_id} WHERE term_id IS NULL;
            ALTER TABLE curriculums DROP CONSTRAINT IF EXISTS uq_curriculum_assignment;
            ALTER TABLE curriculums ADD CONSTRAINT uq_curriculum_assignment UNIQUE (term_id, group_id, subject_id, teacher_id, second_teacher_id, is_stream, stream_id);

            ALTER TABLE teacher_constraints ADD COLUMN IF NOT EXISTS term_id INTEGER REFERENCES academic_terms(id) ON DELETE CASCADE;
            CREATE INDEX IF NOT EXISTS ix_teacher_constraints_term_id ON teacher_constraints(term_id);
            UPDATE teacher_constraints SET term_id = {default_term_id} WHERE term_id IS NULL;
            ALTER TABLE teacher_constraints DROP CONSTRAINT IF EXISTS uq_teacher_constraint_slot;
            ALTER TABLE teacher_constraints ADD CONSTRAINT uq_teacher_constraint_slot UNIQUE (term_id, teacher_id, day_of_week, lesson_number);

            ALTER TABLE schedule_drafts ADD COLUMN IF NOT EXISTS term_id INTEGER REFERENCES academic_terms(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS ix_schedule_drafts_term_id ON schedule_drafts(term_id);
            UPDATE schedule_drafts SET term_id = {default_term_id} WHERE term_id IS NULL;
        """)


def downgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("curriculums") as batch_op:
            batch_op.drop_constraint("uq_curriculum_assignment", type_="unique")
            batch_op.create_unique_constraint(
                "uq_curriculum_assignment",
                ["group_id", "subject_id", "teacher_id", "second_teacher_id", "is_stream", "stream_id"],
            )
            batch_op.drop_column("term_id")

        with op.batch_alter_table("teacher_constraints") as batch_op:
            batch_op.drop_constraint("uq_teacher_constraint_slot", type_="unique")
            batch_op.create_unique_constraint(
                "uq_teacher_constraint_slot",
                ["teacher_id", "day_of_week", "lesson_number"],
            )
            batch_op.drop_column("term_id")

        with op.batch_alter_table("schedule_drafts") as batch_op:
            batch_op.drop_column("term_id")
    else:
        op.execute("""
            ALTER TABLE curriculums DROP CONSTRAINT IF EXISTS uq_curriculum_assignment;
            ALTER TABLE curriculums ADD CONSTRAINT uq_curriculum_assignment UNIQUE (group_id, subject_id, teacher_id, second_teacher_id, is_stream, stream_id);
            ALTER TABLE curriculums DROP COLUMN IF EXISTS term_id;

            ALTER TABLE teacher_constraints DROP CONSTRAINT IF EXISTS uq_teacher_constraint_slot;
            ALTER TABLE teacher_constraints ADD CONSTRAINT uq_teacher_constraint_slot UNIQUE (teacher_id, day_of_week, lesson_number);
            ALTER TABLE teacher_constraints DROP COLUMN IF EXISTS term_id;

            ALTER TABLE schedule_drafts DROP COLUMN IF EXISTS term_id;
        """)

    op.drop_table("term_course_schedules")
    op.drop_table("academic_terms")