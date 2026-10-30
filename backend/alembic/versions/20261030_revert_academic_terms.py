"""Revert academic terms to restore clean schema matching f4fe75a

Revision ID: 20261030_revert_academic_terms
Revises: 20261030_add_academic_terms
"""
from alembic import op
import sqlalchemy as sa

revision = "20261030_revert_academic_terms"
down_revision = "20261030_add_academic_terms"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("curriculums") as batch_op:
            try:
                batch_op.drop_constraint("uq_curriculum_assignment", type_="unique")
            except Exception:
                pass
            try:
                batch_op.create_unique_constraint(
                    "uq_curriculum_assignment",
                    ["group_id", "subject_id", "teacher_id", "second_teacher_id", "is_stream", "stream_id"]
                )
            except Exception:
                pass
            try:
                batch_op.drop_column("term_id")
            except Exception:
                pass

        with op.batch_alter_table("teacher_constraints") as batch_op:
            try:
                batch_op.drop_constraint("uq_teacher_constraint_slot", type_="unique")
            except Exception:
                pass
            try:
                batch_op.create_unique_constraint(
                    "uq_teacher_constraint_slot",
                    ["teacher_id", "day_of_week", "lesson_number"]
                )
            except Exception:
                pass
            try:
                batch_op.drop_column("term_id")
            except Exception:
                pass

        try:
            op.drop_table("academic_terms")
        except Exception:
            pass
    else:
        statements = [
            "ALTER TABLE curriculums DROP CONSTRAINT IF EXISTS uq_curriculum_assignment",
            """
            DELETE FROM curriculums c1
            USING curriculums c2
            WHERE c1.id > c2.id
              AND c1.group_id = c2.group_id
              AND c1.subject_id = c2.subject_id
              AND c1.teacher_id = c2.teacher_id
              AND (c1.second_teacher_id IS NOT DISTINCT FROM c2.second_teacher_id)
              AND c1.is_stream = c2.is_stream
              AND (c1.stream_id IS NOT DISTINCT FROM c2.stream_id)
            """,
            "ALTER TABLE curriculums ADD CONSTRAINT uq_curriculum_assignment UNIQUE (group_id, subject_id, teacher_id, second_teacher_id, is_stream, stream_id)",
            "ALTER TABLE curriculums DROP COLUMN IF EXISTS term_id CASCADE",
            "ALTER TABLE teacher_constraints DROP CONSTRAINT IF EXISTS uq_teacher_constraint_slot",
            """
            DELETE FROM teacher_constraints tc1
            USING teacher_constraints tc2
            WHERE tc1.id > tc2.id
              AND tc1.teacher_id = tc2.teacher_id
              AND tc1.day_of_week = tc2.day_of_week
              AND (tc1.lesson_number IS NOT DISTINCT FROM tc2.lesson_number)
            """,
            "ALTER TABLE teacher_constraints ADD CONSTRAINT uq_teacher_constraint_slot UNIQUE (teacher_id, day_of_week, lesson_number)",
            "ALTER TABLE teacher_constraints DROP COLUMN IF EXISTS term_id CASCADE",
            "DROP TABLE IF EXISTS academic_terms CASCADE",
        ]
        for stmt in statements:
            try:
                op.execute(stmt)
            except Exception:
                pass


def downgrade():
    pass
