"""Permanent schedule sync and Neon -> Supabase database migration services."""

import logging

from fastapi import HTTPException
from sqlalchemy import delete, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import Base
from app.models import Schedule, ScheduleOverride, ScheduleVersion
from app.schemas.admin_import import MigrateRequest, PermanentSyncRequest
from app.services import cache_rev
from app.services.versions import lock_versions

logger = logging.getLogger(__name__)


async def sync_permanent_schedule(db: AsyncSession, payload: PermanentSyncRequest) -> dict:
    """
    Транзакційно синхронізує постійний розклад у базовому шаблоні Schedule
    для вказаної версії (за замовчуванням версія 1).
    """
    version = await db.get(ScheduleVersion, payload.version_id)
    if version is None:
        raise HTTPException(404, "Версію розкладу не знайдено")

    await lock_versions(db)

    # 1. Відв'язуємо оверрайди від старих записів розкладу
    schedule_subquery = select(Schedule.id).where(Schedule.version_id == payload.version_id)
    await db.execute(
        update(ScheduleOverride)
        .where(ScheduleOverride.schedule_id.in_(schedule_subquery))
        .values(schedule_id=None)
    )

    # 2. Видаляємо старі записи розкладу цієї версії
    await db.execute(delete(Schedule).where(Schedule.version_id == payload.version_id))

    # 3. Вставляємо нові перевірені слоти
    fields = (
        "group_id", "day_of_week", "lesson_number", "subject_id",
        "teacher_id", "second_teacher_id", "room_override", "week_type",
    )
    rows_to_insert = [
        {
            **{f: item.get(f) for f in fields},
            "version_id": payload.version_id,
            "is_active": True,
            "is_replacement": False,
        }
        for item in payload.lessons
        if item.get("group_id") and item.get("subject_id") and item.get("day_of_week") and item.get("lesson_number")
    ]

    if rows_to_insert:
        await db.execute(insert(Schedule), rows_to_insert)

    # 4. Скидаємо глобальну ревізію кешу
    cache_rev.bump(global_=True)
    await db.commit()

    return {
        "status": "success",
        "version_id": payload.version_id,
        "synced_lessons_count": len(rows_to_insert),
    }


async def migrate_from_neon_db(db: AsyncSession, payload: MigrateRequest) -> dict:
    """Migrate data from an external Neon PostgreSQL database into the active database."""
    neon_url = payload.neon_url.strip()
    if neon_url.startswith("postgresql://"):
        neon_url = neon_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif neon_url.startswith("postgres://"):
        neon_url = neon_url.replace("postgres://", "postgresql+psycopg://", 1)

    remote_engine = create_async_engine(neon_url)
    stats = {}

    tables_to_check = [
        "faculties",
        "teachers",
        "groups",
        "subjects",
        "users",
        "user_group_access",
        "entity_aliases",
        "settings",
        "token_blocklist",
        "bell_schedule",
        "schedule_versions",
        "schedule_periods",
        "schedule_period_groups",
        "schedule_period_slots",
        "schedule_slots",
        "schedule_drafts",
        "teacher_constraints",
        "schedule_publications",
        "curriculums",
        "schedule",
        "schedule_publication_snapshots",
        "imported_schedule_changes",
        "schedule_override",
        "lesson_occurrence_notes",
        "lesson_note_revisions",
        "classroom_credentials",
        "group_students",
        "classroom_group_bindings",
        "schedule_events",
        "academic_events",
        "feedback",
    ]

    try:
        # Step 1: Wipe existing Supabase data if requested
        existing_dest_tables = set(
            (await db.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
            )).scalars().all()
        )

        if payload.wipe_supabase:
            logger.info("Wiping all Supabase application tables before migration...")
            tables_to_truncate = [t for t in reversed(tables_to_check) if t in existing_dest_tables]
            if tables_to_truncate:
                truncate_stmt = f"TRUNCATE TABLE {', '.join(tables_to_truncate)} CASCADE;"
                try:
                    await db.execute(text(truncate_stmt))
                    await db.commit()
                    stats["wiped"] = True
                    logger.info("Supabase application tables successfully truncated.")
                except Exception as w_err:
                    logger.error(f"Failed to truncate tables: {w_err}")
                    await db.rollback()
                    return {"status": "error", "error": f"Truncate failed: {w_err}"}

        async with remote_engine.connect() as remote_conn:
            try:
                await db.execute(text("SET session_replication_role = 'replica'"))
            except Exception:
                pass

            for tbl in tables_to_check:
                if tbl not in existing_dest_tables:
                    continue
                try:
                    exists = await remote_conn.scalar(
                        text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :t)"),
                        {"t": tbl}
                    )
                    if not exists:
                        continue

                    rows = (await remote_conn.execute(text(f"SELECT * FROM {tbl}"))).mappings().all()
                    stats[tbl] = len(rows)

                    if not rows:
                        continue

                    dest_cols = set(
                        (await db.execute(
                            text("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :t"),
                            {"t": tbl}
                        )).scalars().all()
                    )

                    table_obj = Base.metadata.tables.get(tbl)
                    chunk_size = 200

                    valid_group_ids = set((await db.execute(text("SELECT id FROM groups"))).scalars().all()) if tbl in ("teachers", "group_students", "classroom_group_bindings", "curriculums", "lesson_occurrence_notes", "schedule_publication_snapshots", "imported_schedule_changes", "schedule_override", "schedule", "schedule_slots", "schedule_period_groups") else set()
                    valid_subject_ids = list((await db.execute(text("SELECT id FROM subjects"))).scalars().all()) if tbl in ("curriculums", "schedule", "schedule_slots", "lesson_occurrence_notes", "imported_schedule_changes", "schedule_override", "academic_events") else []
                    valid_subject_ids_set = set(valid_subject_ids)
                    fallback_subject = valid_subject_ids[0] if valid_subject_ids else 1

                    valid_teacher_ids = set((await db.execute(text("SELECT id FROM teachers"))).scalars().all()) if tbl in ("curriculums", "schedule", "schedule_slots", "imported_schedule_changes", "schedule_override", "academic_events", "teacher_constraints") else set()
                    valid_version_ids = set((await db.execute(text("SELECT id FROM schedule_versions"))).scalars().all()) if tbl in ("schedule",) else set()
                    valid_pub_ids = set((await db.execute(text("SELECT id FROM schedule_publications"))).scalars().all()) if tbl in ("schedule_publication_snapshots", "imported_schedule_changes") else set()
                    valid_draft_ids = set((await db.execute(text("SELECT id FROM schedule_drafts"))).scalars().all()) if tbl in ("imported_schedule_changes",) else set()
                    valid_note_ids = set((await db.execute(text("SELECT id FROM lesson_occurrence_notes"))).scalars().all()) if tbl in ("lesson_note_revisions",) else set()
                    valid_cred_ids = set((await db.execute(text("SELECT id FROM classroom_credentials"))).scalars().all()) if tbl in ("classroom_group_bindings",) else set()

                    for i in range(0, len(rows), chunk_size):
                        batch = rows[i:i + chunk_size]
                        clean_batch = []
                        for r in batch:
                            item = {k: v for k, v in dict(r).items() if k in dest_cols}

                            if tbl == "schedule":
                                if item.get("version_id") and item.get("version_id") not in valid_version_ids:
                                    item["version_id"] = None
                                if item.get("group_id") not in valid_group_ids:
                                    continue
                                if item.get("subject_id") and item.get("subject_id") not in valid_subject_ids_set:
                                    item["subject_id"] = fallback_subject
                                if item.get("teacher_id") and item.get("teacher_id") not in valid_teacher_ids:
                                    item["teacher_id"] = None
                                if item.get("second_teacher_id") and item.get("second_teacher_id") not in valid_teacher_ids:
                                    item["second_teacher_id"] = None

                            elif tbl == "lesson_occurrence_notes":
                                if item.get("group_id") not in valid_group_ids:
                                    continue
                                if item.get("subject_id") not in valid_subject_ids_set:
                                    item["subject_id"] = fallback_subject

                            elif tbl == "lesson_note_revisions":
                                if item.get("note_id") not in valid_note_ids:
                                    continue

                            elif tbl == "curriculums":
                                if item.get("group_id") not in valid_group_ids or item.get("subject_id") not in valid_subject_ids_set:
                                    continue
                                if item.get("teacher_id") and item.get("teacher_id") not in valid_teacher_ids:
                                    item["teacher_id"] = None

                            elif tbl == "schedule_publication_snapshots":
                                if item.get("group_id") not in valid_group_ids or item.get("publication_id") not in valid_pub_ids:
                                    continue

                            elif tbl == "imported_schedule_changes":
                                if item.get("group_id") not in valid_group_ids:
                                    continue
                                if item.get("publication_id") and item.get("publication_id") not in valid_pub_ids:
                                    item["publication_id"] = None
                                if item.get("draft_id") and item.get("draft_id") not in valid_draft_ids:
                                    item["draft_id"] = None
                                if item.get("teacher_id") and item.get("teacher_id") not in valid_teacher_ids:
                                    item["teacher_id"] = None
                                if item.get("second_teacher_id") and item.get("second_teacher_id") not in valid_teacher_ids:
                                    item["second_teacher_id"] = None
                                if item.get("subject_id") and item.get("subject_id") not in valid_subject_ids_set:
                                    item["subject_id"] = fallback_subject

                            elif tbl == "schedule_override":
                                if item.get("group_id") not in valid_group_ids:
                                    continue
                                if item.get("teacher_id") and item.get("teacher_id") not in valid_teacher_ids:
                                    item["teacher_id"] = None
                                if item.get("second_teacher_id") and item.get("second_teacher_id") not in valid_teacher_ids:
                                    item["second_teacher_id"] = None
                                if item.get("subject_id") and item.get("subject_id") not in valid_subject_ids_set:
                                    item["subject_id"] = fallback_subject

                            elif tbl in ("group_students",):
                                if item.get("group_id") not in valid_group_ids:
                                    continue

                            elif tbl == "classroom_group_bindings":
                                if item.get("group_id") not in valid_group_ids:
                                    continue
                                if item.get("credential_id") and item.get("credential_id") not in valid_cred_ids:
                                    continue

                            clean_batch.append(item)

                        if clean_batch:
                            if table_obj is not None:
                                if tbl == "curriculums":
                                    ins = pg_insert(table_obj).values(clean_batch)
                                    stmt = ins.on_conflict_do_update(
                                        index_elements=["id"],
                                        set_={
                                            "strict_day": ins.excluded.strict_day,
                                            "strict_lesson": ins.excluded.strict_lesson,
                                        }
                                    )
                                else:
                                    stmt = pg_insert(table_obj).values(clean_batch).on_conflict_do_nothing()
                                await db.execute(stmt)
                            else:
                                for item in clean_batch:
                                    cols = list(item.keys())
                                    col_names = ", ".join(cols)
                                    param_names = ", ".join(f":{c}" for c in cols)
                                    stmt = text(f"INSERT INTO {tbl} ({col_names}) VALUES ({param_names}) ON CONFLICT DO NOTHING")
                                    await db.execute(stmt, item)

                    await db.commit()
                except Exception as tbl_e:
                    logger.warning(f"Error migrating table {tbl}: {tbl_e}")
                    stats[f"{tbl}_error"] = str(tbl_e)
                    await db.rollback()

            try:
                await db.execute(text("SET session_replication_role = 'origin'"))
            except Exception:
                pass

            for tbl in tables_to_check:
                try:
                    await db.execute(text(f"SELECT setval(pg_get_serial_sequence('{tbl}', 'id'), COALESCE((SELECT MAX(id) FROM {tbl}), 1))"))
                    await db.commit()
                except Exception:
                    pass

        return {"status": "success", "migrated_stats": stats}
    except Exception as e:
        logger.error(f"Migration error: {e}", exc_info=True)
        return {"status": "error", "error": str(e), "stats": stats}
    finally:
        await remote_engine.dispose()
