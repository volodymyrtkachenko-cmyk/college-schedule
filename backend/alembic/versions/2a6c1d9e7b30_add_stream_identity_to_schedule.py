"""Persist explicit stream identity on published schedule entries.

Revision ID: 2a6c1d9e7b30
Revises: e19a4bd38c72
"""
from alembic import op
import sqlalchemy as sa


revision = "2a6c1d9e7b30"
down_revision = "e19a4bd38c72"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedule", sa.Column("stream_id", sa.String(length=100), nullable=True))
    op.execute(
        """
        UPDATE schedule
        SET stream_id = (
            SELECT c.stream_id
            FROM curriculums AS c
            WHERE c.is_stream = true
              AND c.stream_id IS NOT NULL
              AND c.group_id = schedule.group_id
              AND c.subject_id = schedule.subject_id
              AND c.teacher_id = schedule.teacher_id
              AND (
                    c.second_teacher_id = schedule.second_teacher_id
                    OR (c.second_teacher_id IS NULL AND schedule.second_teacher_id IS NULL)
              )
              AND NOT EXISTS (
                    SELECT 1
                    FROM curriculums AS other
                    WHERE other.is_stream = true
                      AND other.stream_id IS NOT NULL
                      AND other.group_id = c.group_id
                      AND other.subject_id = c.subject_id
                      AND other.teacher_id = c.teacher_id
                      AND (
                            other.second_teacher_id = c.second_teacher_id
                            OR (other.second_teacher_id IS NULL AND c.second_teacher_id IS NULL)
                      )
                      AND other.stream_id != c.stream_id
              )
            LIMIT 1
        )
        WHERE EXISTS (
            SELECT 1
            FROM curriculums AS c
            WHERE c.is_stream = true
              AND c.stream_id IS NOT NULL
              AND c.group_id = schedule.group_id
              AND c.subject_id = schedule.subject_id
              AND c.teacher_id = schedule.teacher_id
              AND (
                    c.second_teacher_id = schedule.second_teacher_id
                    OR (c.second_teacher_id IS NULL AND schedule.second_teacher_id IS NULL)
              )
              AND NOT EXISTS (
                    SELECT 1
                    FROM curriculums AS other
                    WHERE other.is_stream = true
                      AND other.stream_id IS NOT NULL
                      AND other.group_id = c.group_id
                      AND other.subject_id = c.subject_id
                      AND other.teacher_id = c.teacher_id
                      AND (
                            other.second_teacher_id = c.second_teacher_id
                            OR (other.second_teacher_id IS NULL AND c.second_teacher_id IS NULL)
                      )
                      AND other.stream_id != c.stream_id
              )
        )
        """
    )


def downgrade() -> None:
    op.drop_column("schedule", "stream_id")
