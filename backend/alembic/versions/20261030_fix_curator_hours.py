"""Fix curator hours and sync strict fields

Revision ID: 20261030_fix_curator_hours
Revises: 20261030_add_strict_fields
"""
from alembic import op
import sqlalchemy as sa


revision = "20261030_fix_curator_hours"
down_revision = "20261030_add_strict_fields"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Direct SQL update for Виховна година: pinned to Thursday (day 4), 4th lesson (slot 4)
    op.execute(
        """
        UPDATE curriculums
        SET 
            strict_day = 4,
            strict_lesson = 4,
            is_fixed = true,
            pairs_per_2_weeks = 2,
            require_week = NULL
        WHERE subject_id IN (
            SELECT id FROM subjects WHERE name = 'Виховна година'
        );
        """
    )

    # 2. Sync any additional strict/fixed fields from Neon if reachable
    try:
        import psycopg
        neon_url = "postgresql://neondb_owner:npg_OjW4Zdk7ERPy@ep-mute-resonance-b15fvcwp-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require"
        with psycopg.connect(neon_url, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, strict_day, strict_lesson, is_fixed, require_week "
                    "FROM curriculums WHERE strict_day IS NOT NULL OR strict_lesson IS NOT NULL OR is_fixed = true"
                )
                rows = cur.fetchall()
                bind = op.get_bind()
                for r in rows:
                    bind.execute(
                        sa.text(
                            "UPDATE curriculums SET strict_day = :sd, strict_lesson = :sl, is_fixed = :fx, require_week = :rw WHERE id = :cid"
                        ),
                        {"sd": r[1], "sl": r[2], "fx": r[3], "rw": r[4], "cid": r[0]}
                    )
    except Exception:
        pass


def downgrade():
    pass
