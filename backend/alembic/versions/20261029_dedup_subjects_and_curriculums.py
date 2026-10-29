"""Deduplicate subjects with asterisk/whitespace variants and per-group curriculums

Revision ID: 20261029_dedup_curriculums
Revises: 20261022_add_change_type
"""
from collections import defaultdict
import re
from alembic import op
import sqlalchemy as sa

revision = "20261029_dedup_curriculums"
down_revision = "20261022_add_change_type"
branch_labels = None
depends_on = None


def _clean_name(value: str) -> str:
    return " ".join((value or "").replace("*", " ").split()).strip()


def _name_key(value: str) -> str:
    key = _clean_name(value).casefold()
    return re.sub(r"[’ʼ`]", "'", key)


def _table_exists(bind, table_name: str) -> bool:
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade():
    bind = op.get_bind()
    if not _table_exists(bind, "subjects") or not _table_exists(bind, "curriculums"):
        return

    subjects_rows = bind.execute(
        sa.text("SELECT id, name, short_name, is_active FROM subjects ORDER BY id")
    ).mappings().all()
    if not subjects_rows:
        return

    orig_subj_names = {r["id"]: (r["name"] or "") for r in subjects_rows}

    def subj_sort_key(r):
        name = r["name"] or ""
        cleaned = _clean_name(name)
        has_ast = "*" in name
        is_clean = name.strip() == cleaned and not has_ast
        return (
            0 if r["is_active"] else 1,
            0 if is_clean else 1,
            0 if not has_ast else 1,
            0 if r["short_name"] else 1,
            r["id"],
        )

    subjects_by_key = defaultdict(list)
    for r in subjects_rows:
        key = _name_key(r["name"] or "")
        if key:
            subjects_by_key[key].append(r)

    subj_to_keeper_id = {}
    for key, group in subjects_by_key.items():
        sorted_group = sorted(group, key=subj_sort_key)
        keeper = sorted_group[0]
        subj_to_keeper_id[keeper["id"]] = keeper["id"]
        for dup in sorted_group[1:]:
            subj_to_keeper_id[dup["id"]] = keeper["id"]

    # 1. Deduplicate curriculums per (group_id, canonical subject key)
    curr_rows = bind.execute(
        sa.text(
            "SELECT id, group_id, subject_id, pairs_per_2_weeks, total_hours, is_fixed, is_stream "
            "FROM curriculums ORDER BY id"
        )
    ).mappings().all()

    currs_by_group_subj = defaultdict(list)
    for c in curr_rows:
        orig_name = orig_subj_names.get(c["subject_id"], "")
        s_key = _name_key(orig_name) or f"__id_{c['subject_id']}"
        currs_by_group_subj[(c["group_id"], s_key)].append(c)

    has_schedule_slots = _table_exists(bind, "schedule_slots")

    for (group_id, s_key), c_list in currs_by_group_subj.items():
        sorted_c = sorted(
            c_list,
            key=lambda c: (
                -(c["pairs_per_2_weeks"] or 0),
                -(c["total_hours"] or 0),
                0 if "*" not in orig_subj_names.get(c["subject_id"], "") else 1,
                0 if (c["is_fixed"] or c["is_stream"]) else 1,
                c["id"],
            ),
        )
        keeper_c = sorted_c[0]
        dups_c = sorted_c[1:]

        if dups_c:
            max_hours = max((c["total_hours"] or 0) for c in c_list)
            if (keeper_c["total_hours"] or 0) == 0 and max_hours > 0:
                bind.execute(
                    sa.text("UPDATE curriculums SET total_hours = :th WHERE id = :id"),
                    {"th": max_hours, "id": keeper_c["id"]},
                )

            if has_schedule_slots:
                keeper_slots = bind.execute(
                    sa.text(
                        "SELECT draft_id, day_of_week, lesson_number, week_type "
                        "FROM schedule_slots WHERE curriculum_id = :cid"
                    ),
                    {"cid": keeper_c["id"]},
                ).mappings().all()
                existing_keys = {
                    (s["draft_id"], s["day_of_week"], s["lesson_number"], s["week_type"])
                    for s in keeper_slots
                }

                for d in dups_c:
                    dup_slots = bind.execute(
                        sa.text(
                            "SELECT id, draft_id, day_of_week, lesson_number, week_type "
                            "FROM schedule_slots WHERE curriculum_id = :cid ORDER BY id"
                        ),
                        {"cid": d["id"]},
                    ).mappings().all()
                    for ds in dup_slots:
                        sk = (ds["draft_id"], ds["day_of_week"], ds["lesson_number"], ds["week_type"])
                        if sk in existing_keys:
                            bind.execute(
                                sa.text("DELETE FROM schedule_slots WHERE id = :id"),
                                {"id": ds["id"]},
                            )
                        else:
                            bind.execute(
                                sa.text("UPDATE schedule_slots SET curriculum_id = :kcid WHERE id = :id"),
                                {"kcid": keeper_c["id"], "id": ds["id"]},
                            )
                            existing_keys.add(sk)

            for d in dups_c:
                bind.execute(
                    sa.text("DELETE FROM curriculums WHERE id = :id"),
                    {"id": d["id"]},
                )

        target_subj_id = subj_to_keeper_id.get(keeper_c["subject_id"])
        if target_subj_id and target_subj_id != keeper_c["subject_id"]:
            bind.execute(
                sa.text("UPDATE curriculums SET subject_id = :sid WHERE id = :id"),
                {"sid": target_subj_id, "id": keeper_c["id"]},
            )

    # 2. Repoint other tables and merge duplicate subjects
    fk_tables = [
        "schedule",
        "schedule_override",
        "schedule_period_slots",
        "imported_schedule_changes",
        "schedule_events",
        "curriculums",
    ]
    existing_fk_tables = [t for t in fk_tables if _table_exists(bind, t)]
    has_notes = _table_exists(bind, "lesson_occurrence_notes")
    has_aliases = _table_exists(bind, "entity_aliases")

    for key, group in subjects_by_key.items():
        sorted_group = sorted(group, key=subj_sort_key)
        keeper = sorted_group[0]
        dups = sorted_group[1:]
        cleaned_name = _clean_name(keeper["name"] or "")

        for d in dups:
            for tbl in existing_fk_tables:
                bind.execute(
                    sa.text(f"UPDATE {tbl} SET subject_id = :kid WHERE subject_id = :did"),
                    {"kid": keeper["id"], "did": d["id"]},
                )
            if has_notes:
                bind.execute(
                    sa.text(
                        "UPDATE lesson_occurrence_notes "
                        "SET subject_id = :kid, subject_name = :sname "
                        "WHERE subject_id = :did"
                    ),
                    {"kid": keeper["id"], "sname": cleaned_name, "did": d["id"]},
                )
            if has_aliases:
                bind.execute(
                    sa.text(
                        "UPDATE entity_aliases SET actual_id = :kid "
                        "WHERE entity_type = 'subject' AND actual_id = :did"
                    ),
                    {"kid": keeper["id"], "did": d["id"]},
                )
            bind.execute(
                sa.text("DELETE FROM subjects WHERE id = :did"),
                {"did": d["id"]},
            )

        if cleaned_name and keeper["name"] != cleaned_name:
            bind.execute(
                sa.text("UPDATE subjects SET name = :name WHERE id = :id"),
                {"name": cleaned_name, "id": keeper["id"]},
            )
            if has_notes:
                bind.execute(
                    sa.text(
                        "UPDATE lesson_occurrence_notes SET subject_name = :sname WHERE subject_id = :kid"
                    ),
                    {"sname": cleaned_name, "kid": keeper["id"]},
                )


def downgrade():
    pass
