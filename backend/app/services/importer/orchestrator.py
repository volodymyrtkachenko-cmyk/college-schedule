"""Schedule import orchestration, safety guards, auto-publishing, and status queries."""

import asyncio
from collections import Counter
from datetime import date, datetime, timedelta
import hashlib
import hmac
import json
import logging
import traceback
import uuid

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.analytics import record_successful_import, set_active_jobs
from app.config import settings
from app.core.time import now_local
from app.database import engine
from app.models import (
    Curriculum,
    Group,
    ImportedScheduleChange,
    Schedule,
    ScheduleDraft,
    ScheduleOverride,
    ScheduleSlot,
    ScheduleVersion,
    Subject,
    Teacher,
)
from app.models.entities import SchedulePublication, SchedulePublicationSnapshot
from app.services.import_lock import import_mutex
from app.services.import_slot_safety import normalize_base_slots, version_for_import
from app.services.importer.differ import ScheduleDiffer
from app.services.importer.fetcher import ScheduleFetcher
from app.services.importer.hashing import (
    canonical_change_records as _canonical_change_records,
    import_changes_hash,
    import_payload_hash,
    normalize_room as _normalize_room,
)
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.parsers.kre_parser import KREParser
from app.services.importer.validation import (
    _change_payload,
    _deduplicate_import_changes,
    _latest_published_changes,
    _week_matches,
    annotate_substitutions_and_swaps,
    get_import_settings,
    matches_published_schedule,
    validate_and_sanitize_import_items,
)
from app.services.settings import settings_service
from app.services.week import get_week_type

logger = logging.getLogger(__name__)
IMPORT_PAGE_RETRIES = 3


def verify_import_cron_secret(cron_key: str | None) -> None:
    """Validate incoming X-Cron-Key header against configured secret."""
    import_secret = getattr(settings, "IMPORT_CRON_SECRET", None)
    if not import_secret or not cron_key:
        logger.warning("Cron import denied: missing configuration or key")
        raise HTTPException(status_code=401, detail="Unauthorized cron")

    if not hmac.compare_digest(cron_key.encode(), import_secret.encode()):
        logger.warning("Cron import denied: invalid key")
        raise HTTPException(status_code=401, detail="Unauthorized cron")


async def get_import_status_summary(db: AsyncSession) -> dict:
    """Build status summary for admin import dashboard and notifications."""
    import_settings = await get_import_settings(db)

    last_pub = await db.scalar(
        select(SchedulePublication)
        .order_by(SchedulePublication.id.desc())
        .limit(1)
    )
    last_pub_info = None
    if last_pub:
        scope = {}
        try:
            scope = json.loads(last_pub.scope_manifest or "{}")
        except Exception:
            pass
        source = scope.get("source") or ("auto" if last_pub.actor_id is None else "manual")
        changes_count = scope.get("changes_count", 0)
        last_pub_info = {
            "id": last_pub.id,
            "version_id": last_pub.version_id,
            "source": "Авто" if source == "auto" else "Вручну",
            "source_raw": source,
            "timestamp": last_pub.timestamp.isoformat(),
            "changes_count": changes_count,
            "is_reverted": last_pub.is_reverted,
        }

    anomaly_drafts = (await db.scalars(
        select(ScheduleDraft)
        .where(
            ScheduleDraft.draft_type == "import",
            ScheduleDraft.status == "pending",
        )
        .order_by(ScheduleDraft.id.desc())
    )).all()

    anomaly_info = None
    anomaly_count = 0
    latest_pending = None
    for ad in anomaly_drafts:
        data = ad.data or {}
        skip_reason = data.get("auto_publish_skipped_reason")
        if not skip_reason:
            if data.get("is_anomaly"):
                skip_reason = "anomaly"
            elif not import_settings.get("auto_publish", True):
                skip_reason = "disabled"

        if latest_pending is None:
            latest_pending = {
                "id": ad.id,
                "name": ad.name,
                "changes_count": data.get("changes_count", len(data.get("substitutions", [])) + len(data.get("cancelled", []))),
                "is_anomaly": bool(data.get("is_anomaly")),
                "anomaly_reasons": data.get("anomaly_reasons", []),
                "auto_publish_skipped_reason": skip_reason,
                "created_at": ad.created_at.isoformat() if ad.created_at else None,
            }

        if data.get("is_anomaly"):
            anomaly_count += 1
            if anomaly_info is None:
                anomaly_info = {
                    "id": ad.id,
                    "name": ad.name,
                    "changes_count": data.get("changes_count", len(data.get("substitutions", [])) + len(data.get("cancelled", []))),
                    "anomaly_reasons": data.get("anomaly_reasons", []),
                    "auto_publish_skipped_reason": skip_reason or "anomaly",
                    "created_at": ad.created_at.isoformat() if ad.created_at else None,
                }

    notif_raw = await settings_service.get(db, "import_latest_notification")
    active_notif = None
    if notif_raw:
        try:
            parsed = json.loads(notif_raw)
            if not parsed.get("dismissed"):
                pub_id = parsed.get("publication_id")
                pub = await db.get(SchedulePublication, pub_id) if pub_id else None
                if pub and not pub.is_reverted:
                    active_notif = parsed
                    if "replacements_count" not in active_notif or "swaps_count" not in active_notif:
                        snapshots = (await db.scalars(
                            select(SchedulePublicationSnapshot)
                            .where(SchedulePublicationSnapshot.publication_id == pub.id)
                        )).all()
                        swaps = 0
                        replacements = 0
                        dates_set = set()
                        for s in snapshots:
                            if s.date:
                                dates_set.add(s.date.isoformat())
                            adata = json.loads(s.after_data or "{}")
                            if adata.get("is_swap") or adata.get("change_type") == "swap" or "Перестановка" in (adata.get("summary") or ""):
                                swaps += 1
                            else:
                                replacements += 1
                        active_notif["replacements_count"] = replacements
                        active_notif["swaps_count"] = swaps
                        if not active_notif.get("dates") and dates_set:
                            active_notif["dates"] = sorted(list(dates_set))
        except Exception:
            pass

    last_check_raw = await settings_service.get(db, "import_last_check_status")
    last_check = None
    if last_check_raw:
        try:
            last_check = json.loads(last_check_raw)
        except Exception:
            pass

    return {
        "settings": import_settings,
        "last_publication": last_pub_info,
        "last_check": last_check,
        "pending_anomaly_draft": anomaly_info,
        "latest_pending_draft": latest_pending,
        "anomaly_drafts_count": anomaly_count,
        "active_notification": active_notif,
    }


async def update_import_settings_values(db: AsyncSession, payload: dict) -> dict:
    """Validate and persist import configuration settings."""
    if "auto_publish" in payload:
        await settings_service.set(
            db,
            "import_auto_publish",
            "true" if payload["auto_publish"] else "false",
        )
    if "anomaly_group_threshold" in payload:
        val = float(payload["anomaly_group_threshold"])
        if not 0.05 <= val <= 1.0:
            raise HTTPException(422, "anomaly_group_threshold must be between 0.05 and 1.0")
        await settings_service.set(db, "import_anomaly_group_threshold", str(val))
    if "anomaly_total_threshold" in payload:
        val = float(payload["anomaly_total_threshold"])
        if not 0.05 <= val <= 1.0:
            raise HTTPException(422, "anomaly_total_threshold must be between 0.05 and 1.0")
        await settings_service.set(db, "import_anomaly_total_threshold", str(val))
    return await get_import_settings(db)


async def dismiss_import_notification(db: AsyncSession) -> dict:
    """Mark latest import admin notification as dismissed."""
    notif_raw = await settings_service.get(db, "import_latest_notification")
    if notif_raw:
        try:
            parsed = json.loads(notif_raw)
            parsed["dismissed"] = True
            await settings_service.set(db, "import_latest_notification", json.dumps(parsed))
        except Exception:
            pass
    return {"status": "dismissed"}


async def execute_import_logic(db: AsyncSession, weeks: int = 2, actor_id: int | None = None):
    if not 1 <= weeks <= 4:
        raise HTTPException(422, "Weeks must be between 1 and 4")
    error_id = str(uuid.uuid4())
    try:
        async with import_mutex(engine, error_id):
            return await _do_import(db, weeks, error_id, actor_id=actor_id)
    except HTTPException:
        raise
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Import infrastructure failed [%s]", error_id)
        raise HTTPException(503, detail={
            "msg": "Імпорт тимчасово недоступний. Зверніться до підтримки.",
            "error_id": error_id,
        })


async def _sync_postgres_sequences(db: AsyncSession, tables: tuple[str, ...]) -> None:
    for tbl in tables:
        try:
            await db.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{tbl}', 'id'), COALESCE((SELECT MAX(id) FROM {tbl}), 1))"
            ))
        except Exception:
            pass


def _parse_html_sync(parser: KREParser, raw_html: str):
    p_hash = hashlib.sha256(raw_html.encode("utf-8")).hexdigest()
    parsed_obj = parser.parse(raw_html)
    from selectolax.parser import HTMLParser
    tree = HTMLParser(raw_html)
    next_week_node = tree.css_first("a[aria-label='Наступний тиждень']")
    next_href = next_week_node.attributes.get("href") if next_week_node else None
    return p_hash, parsed_obj, next_href


async def _fetch_group_pages(
    semaphore: asyncio.Semaphore,
    client: httpx.AsyncClient,
    fetcher: ScheduleFetcher,
    parser: KREParser,
    g_id,
    weeks: int,
    errors: list[dict],
) -> list[tuple]:
    async with semaphore:
        parsed_results = []
        url = f"{fetcher.base_url}?group={g_id}"
        visited_urls: set[str] = set()
        visited_hashes: set[str] = set()

        for _ in range(weeks):
            try:
                if url in visited_urls:
                    logger.warning("Stopping repeated import page URL for group %s: %s", g_id, url)
                    break
                visited_urls.add(url)
                last_error: Exception | None = None
                html = None
                for attempt in range(IMPORT_PAGE_RETRIES):
                    try:
                        html = await fetcher.fetch_html(client, url)
                        break
                    except (httpx.HTTPError, asyncio.TimeoutError) as exc:
                        last_error = exc
                        if attempt + 1 < IMPORT_PAGE_RETRIES:
                            await asyncio.sleep(0.25 * (attempt + 1))
                if html is None:
                    raise last_error or RuntimeError("Unable to fetch import page")
                page_hash, parsed, href = await asyncio.to_thread(_parse_html_sync, parser, html)
                if page_hash in visited_hashes:
                    logger.warning("Skipping repeated import page hash for group %s: %s", g_id, url)
                    break
                visited_hashes.add(page_hash)
                parsed_results.append((parsed, url, page_hash))

                if href:
                    if not href.startswith("http"):
                        href = "https://kre.dp.ua" + (href if href.startswith("/") else f"/{href}")
                    url = href
                else:
                    break
            except Exception as e:
                logger.error(f"Error parsing group {g_id} at {url}: {e}")
                errors.append({"group": g_id, "url": url, "error": str(e)})
                break

        return parsed_results


async def _exclude_manual_edits(
    db: AsyncSession,
    substitutions: list[dict],
    cancelled: list[dict],
    groups_map: dict[int, Group],
) -> tuple[list[dict], list[dict], list[dict]]:
    """Protect manually edited changes and ScheduleOverrides from import overwrites."""
    skipped_manual: list[dict] = []
    clean_substitutions: list[dict] = []
    clean_cancelled: list[dict] = []

    all_target_dates = {
        datetime.strptime(item["date"], "%Y-%m-%d").date()
        for item in [*substitutions, *cancelled]
        if item.get("date")
    }
    all_target_groups = {
        item["group_id"]
        for item in [*substitutions, *cancelled]
        if item.get("group_id") is not None
    }

    manual_cells: set[tuple[int, date, int | None]] = set()
    override_cells: set[tuple[int, date, int | None]] = set()
    if all_target_dates and all_target_groups:
        manual_rows = (
            await db.execute(
                select(
                    ImportedScheduleChange.group_id,
                    ImportedScheduleChange.date,
                    ImportedScheduleChange.lesson_number,
                ).where(
                    ImportedScheduleChange.date.in_(all_target_dates),
                    ImportedScheduleChange.group_id.in_(all_target_groups),
                    ImportedScheduleChange.is_published.is_(True),
                    ImportedScheduleChange.manually_edited.is_(True),
                )
            )
        ).all()
        manual_cells = {(r[0], r[1], r[2]) for r in manual_rows}

        override_rows = (
            await db.execute(
                select(
                    ScheduleOverride.group_id,
                    ScheduleOverride.date,
                    ScheduleOverride.lesson_number,
                ).where(
                    ScheduleOverride.date.in_(all_target_dates),
                    ScheduleOverride.group_id.in_(all_target_groups),
                )
            )
        ).all()
        override_cells = {(r[0], r[1], r[2]) for r in override_rows}

    for kind, items, clean_target in (
        ("substitution", substitutions, clean_substitutions),
        ("cancelled", cancelled, clean_cancelled),
    ):
        for item in items:
            d_obj = datetime.strptime(item["date"], "%Y-%m-%d").date()
            cell_key = (item["group_id"], d_obj, item["lesson_number"])
            if cell_key in manual_cells or cell_key in override_cells:
                skipped_manual.append({
                    "group_id": item["group_id"],
                    "group_name": groups_map.get(item["group_id"]).name if groups_map.get(item["group_id"]) else None,
                    "date": item["date"],
                    "lesson_number": item["lesson_number"],
                    "kind": kind,
                })
            else:
                clean_target.append(item)

    return clean_substitutions, clean_cancelled, skipped_manual


async def _exclude_reverted_changes(
    db: AsyncSession,
    clean_substitutions: list[dict],
    clean_cancelled: list[dict],
    group_page_hashes: dict[str, list[str]],
) -> tuple[list[dict], list[dict], list[dict]]:
    """Suppress reverted publication changes until the source page hash changes."""
    skipped_reverted: list[dict] = []
    latest_active_pub_id = await db.scalar(
        select(func.max(SchedulePublication.id)).where(SchedulePublication.is_reverted.is_(False))
    ) or 0
    reverted_pubs = (await db.scalars(
        select(SchedulePublication).where(
            SchedulePublication.is_reverted.is_(True),
            SchedulePublication.id > latest_active_pub_id,
        )
    )).all()

    suppressed_change_keys = set()
    for rp in reverted_pubs:
        if not rp.source_fingerprint:
            continue
        try:
            fp_data = json.loads(rp.source_fingerprint)
            prev_hashes = fp_data.get("page_hashes", {})
        except Exception:
            continue

        rp_changes = (await db.scalars(
            select(ImportedScheduleChange).where(ImportedScheduleChange.publication_id == rp.id)
        )).all()
        for rc in rp_changes:
            gid_str = str(rc.group_id)
            curr_h = group_page_hashes.get(gid_str, [])
            prev_h = prev_hashes.get(gid_str, [])
            if curr_h and prev_h and curr_h == prev_h:
                suppressed_change_keys.add((rc.group_id, rc.date.isoformat(), rc.lesson_number, rc.kind))

    unsuppressed_substitutions: list[dict] = []
    unsuppressed_cancelled: list[dict] = []
    for kind, items, unsuppressed_target in (
        ("substitution", clean_substitutions, unsuppressed_substitutions),
        ("cancelled", clean_cancelled, unsuppressed_cancelled),
    ):
        for item in items:
            key = (item["group_id"], item["date"], item["lesson_number"], kind)
            if key in suppressed_change_keys:
                skipped_reverted.append(item)
            else:
                unsuppressed_target.append(item)

    return unsuppressed_substitutions, unsuppressed_cancelled, skipped_reverted


def _restore_base_slots_under_substitutions(
    aggregated_base_slots: list[dict],
    aggregated_substitutions: list[dict],
    current_schedules: list[Schedule],
) -> tuple[list[dict], list[dict]]:
    """Restore permanent base slots under substitutions to avoid holes in draft schedules."""
    restored_base_slots = []
    for sub in aggregated_substitutions:
        dow = datetime.strptime(sub["date"], "%Y-%m-%d").date().isoweekday()
        sub_week = sub.get("week_type", "both")
        same_cell = [
            s for s in aggregated_base_slots
            if s["group_id"] == sub["group_id"] and s["day_of_week"] == dow and s["lesson_number"] == sub["lesson_number"]
        ]
        if any(s["week_type"] in ("both", sub_week) or sub_week == "both" for s in same_cell):
            continue
        published = [
            sch for sch in current_schedules
            if sch.group_id == sub["group_id"]
            and sch.day_of_week == dow
            and sch.lesson_number == sub["lesson_number"]
            and sch.is_active
            and (sch.week_type in ("both", sub_week))
        ]
        for sch in published:
            slot = {
                "day_of_week": dow,
                "lesson_number": sub["lesson_number"],
                "group_id": sub["group_id"],
                "subject_id": sch.subject_id,
                "teacher_id": sch.teacher_id,
                "second_teacher_id": sch.second_teacher_id,
                "room": sch.room_override,
                "week_type": sub_week if same_cell else sch.week_type,
            }
            aggregated_base_slots.append(slot)
            restored_base_slots.append(slot)
            same_cell = [*same_cell, slot]

    normalized_base = normalize_base_slots(
        [{**slot, "room": _normalize_room(slot.get("room"))} for slot in aggregated_base_slots],
        prefer_incoming=True,
    )
    normalized_restored = normalize_base_slots(
        [{**slot, "room": _normalize_room(slot.get("room"))} for slot in restored_base_slots],
        prefer_incoming=True,
    )
    return normalized_base, normalized_restored


async def _do_import(db: AsyncSession, weeks: int, error_id: str, actor_id: int | None = None):
    fetcher = ScheduleFetcher()
    parser = KREParser()
    set_active_jobs(1)
    try:
        group_ids = await fetcher.get_all_group_ids()
        if not group_ids:
            raise HTTPException(502, detail={"code": "empty_import_group_list", "msg": "Джерело не повернуло групи. Імпорт зупинено."})

        main_page_hash = getattr(fetcher, "last_main_page_hash", None)

        # Fast-path optimization for scheduled checks when the main page hash hasn't changed
        if actor_id is None and main_page_hash:
            last_main_hash = await settings_service.get(db, "import_last_main_page_hash")
            pending_draft_check = await db.scalar(
                select(ScheduleDraft.id)
                .where(ScheduleDraft.draft_type == "import", ScheduleDraft.status == "pending")
                .limit(1)
            )
            if last_main_hash and last_main_hash == main_page_hash and not pending_draft_check:
                logger.info("Auto-import: main schedule page hash unchanged (%s). Skipping group fetch.", main_page_hash[:10])
                await settings_service.set(
                    db,
                    "import_last_check_status",
                    json.dumps({
                        "checked_at": now_local().isoformat(),
                        "source": "Авто",
                        "status": "unchanged",
                        "changes_count": 0,
                    }),
                )
                await db.commit()
                return {
                    "status": "success",
                    "summary": {
                        "total_changes": 0,
                        "auto_published": False,
                        "changes": [],
                    },
                    "meta": {
                        "unchanged": True,
                        "auto_published": False,
                        "is_anomaly": False,
                        "reason": "main_page_unchanged",
                    },
                }

        aggregated_unresolved = {}
        aggregated_unresolved_subs = []
        aggregated_substitutions = []
        aggregated_cancelled = []
        aggregated_base_slots = []
        aggregated_skipped = []
        errors = []
        imported_dates: set[str] = set()
        imported_group_ids: set[int] = set()
        page_snapshots: list[dict] = []
        seen_page_urls: set[str] = set()
        seen_page_hashes: set[str] = set()
        group_page_hashes: dict[str, list[str]] = {}
        raw_lessons = 0

        semaphore = asyncio.Semaphore(12)
        scraped_weeks: dict[int, set[str]] = {}
        client_limits = httpx.Limits(max_connections=25, max_keepalive_connections=20)
        async with httpx.AsyncClient(timeout=10.0, limits=client_limits) as client:
            tasks = [
                _fetch_group_pages(semaphore, client, fetcher, parser, g_id, weeks, errors)
                for g_id in group_ids
            ]
            parsed_weeks = await asyncio.gather(*tasks, return_exceptions=True)

        normalizer = EntityNormalizer(db)
        await normalizer.load_dictionaries()
        differ = ScheduleDiffer(db, normalizer)
        total_db_groups = await db.scalar(select(func.count(Group.id)).where(Group.is_active.is_(True))) or 0

        for g_idx, parsed_week_list in enumerate(parsed_weeks):
            if isinstance(parsed_week_list, Exception):
                errors.append({"group": group_ids[g_idx], "error": str(parsed_week_list)})
                continue
            for parsed_week in parsed_week_list:
                parsed_week_obj, source_url, page_hash = parsed_week
                gid = group_ids[g_idx]
                page_snapshots.append({
                    "group_id": gid,
                    "url": source_url,
                    "html_hash": page_hash,
                    "dates": sorted({lesson.date.isoformat() for lesson in parsed_week_obj.lessons}),
                    "week_type": parsed_week_obj.week_type,
                })
                seen_page_urls.add(source_url)
                seen_page_hashes.add(page_hash)
                group_page_hashes.setdefault(str(gid), []).append(page_hash)
                raw_lessons += len(parsed_week_obj.lessons)
                imported_dates.update(lesson.date.isoformat() for lesson in parsed_week_obj.lessons)
                diff_report = await differ.diff(parsed_week_obj)
                page_group_ids = {
                    item["group_id"]
                    for key in ("base_slots", "substitutions", "cancelled")
                    for item in diff_report[key]
                }
                for page_group_id in page_group_ids:
                    scraped_weeks.setdefault(page_group_id, set()).add(parsed_week_obj.week_type)
                    group_page_hashes.setdefault(str(page_group_id), []).append(page_hash)
                for item in diff_report["unresolved"]:
                    key = f"{item['type']}_{item['raw']}"
                    aggregated_unresolved[key] = item
                aggregated_substitutions.extend(diff_report["substitutions"])
                aggregated_unresolved_subs.extend(diff_report["unresolved_substitutions"])
                aggregated_cancelled.extend(diff_report["cancelled"])
                aggregated_base_slots.extend(diff_report["base_slots"])
                aggregated_skipped.extend(diff_report["skipped_base_slots"])
                imported_group_ids.update(
                    slot["group_id"] for slot in diff_report["base_slots"]
                )
                imported_group_ids.update(
                    item["group_id"] for item in diff_report["substitutions"]
                )
                imported_group_ids.update(
                    item["group_id"] for item in diff_report["cancelled"]
                )

        # Safety Guard 1 (B3.2): Dubious Parsing
        if errors and not imported_group_ids:
            failed_groups = sorted({
                str(error["group"])
                for error in errors
                if error.get("group") is not None
            })
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "dubious_parsing",
                    "message": "Сайт kre.dp.ua тимчасово недоступний: не вдалося завантажити жодної групи. Імпорт зупинено, розклад не змінено.",
                    "failed_groups": failed_groups,
                    "errors": errors,
                },
            )
        elif raw_lessons == 0:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "dubious_parsing",
                    "message": "Парсинг повернув 0 пар. Імпорт зупинено, наявний розклад не змінено.",
                    "errors": errors,
                },
            )
        elif total_db_groups >= 4 and len(imported_group_ids) < total_db_groups * 0.5:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "dubious_parsing_steep_drop",
                    "message": f"Різке падіння кількості груп ({len(imported_group_ids)} з {total_db_groups}). Імпорт зупинено, наявний розклад не змінено.",
                    "errors": errors,
                },
            )
        elif errors:
            logger.warning(
                "Partial import fallback: %d group(s) timed out on kre.dp.ua, proceeding with %d healthy groups",
                len(errors),
                len(imported_group_ids),
            )

        raw_base_slots = len(aggregated_base_slots)
        raw_substitutions = len(aggregated_substitutions)
        raw_cancelled = len(aggregated_cancelled)

        # Scope dates and target version
        import_version_id = await version_for_import(db, imported_dates, now_local().date())
        scope_dates_obj = {datetime.strptime(value, "%Y-%m-%d").date() for value in imported_dates}

        # Dictionaries
        all_groups = (await db.scalars(select(Group))).all()
        groups_map = {g.id: g for g in all_groups}
        all_subjects = (await db.scalars(select(Subject))).all()
        subjects_map = {s.id: s for s in all_subjects}
        all_teachers = (await db.scalars(select(Teacher))).all()
        teachers_map = {t.id: t for t in all_teachers}

        # Current permanent schedules (read-only for diffing & context, NOT overwritten)
        current_schedules = (await db.scalars(
            select(Schedule)
            .where(
                Schedule.is_active.is_(True),
                Schedule.version_id == import_version_id if import_version_id is not None else Schedule.version_id.is_(None)
            )
            .options(joinedload(Schedule.subject), joinedload(Schedule.teacher), joinedload(Schedule.second_teacher), joinedload(Schedule.group))
        )).all()

        aggregated_substitutions, aggregated_cancelled, aggregated_base_slots = validate_and_sanitize_import_items(
            aggregated_substitutions,
            aggregated_cancelled,
            aggregated_base_slots,
        )
        aggregated_substitutions, aggregated_cancelled = _deduplicate_import_changes(
            aggregated_substitutions,
            aggregated_cancelled,
        )

        semester_start = await settings_service.get_semester_start(db)

        aggregated_substitutions, aggregated_base_slots = annotate_substitutions_and_swaps(
            aggregated_substitutions,
            aggregated_base_slots,
            current_schedules,
            semester_start,
        )

        # Safety Guard 3: Manual edits protection
        clean_substitutions, clean_cancelled, skipped_manual = await _exclude_manual_edits(
            db, aggregated_substitutions, aggregated_cancelled, groups_map
        )

        # Rollback suppression: skip reverted changes until source page changes
        aggregated_substitutions, aggregated_cancelled, skipped_reverted = await _exclude_reverted_changes(
            db, clean_substitutions, clean_cancelled, group_page_hashes
        )

        # Safety Guard 6: Out of version dates
        active_versions = (await db.scalars(
            select(ScheduleVersion).where(ScheduleVersion.is_active.is_(True))
        )).all()

        def is_in_active_version(d_str: str) -> bool:
            try:
                d_val = datetime.strptime(d_str, "%Y-%m-%d").date()
                return any(v.valid_from <= d_val <= v.valid_until for v in active_versions)
            except Exception:
                return True

        out_of_version_items = [
            item for item in [*aggregated_substitutions, *aggregated_cancelled]
            if not is_in_active_version(item["date"])
        ]

        # Safety Guard 2: Anomaly limits
        def _is_auto_publishable_sub(sub: dict) -> bool:
            if sub.get("is_equal_to_base"):
                return False
            return bool(
                sub.get("is_explicit_substitution", True)
                or sub.get("is_swap")
                or sub.get("is_move")
                or (not sub.get("is_equal_to_base") and sub.get("subject_id"))
            )

        changes_per_group = Counter()
        explicit_changes_per_group = Counter()
        for sub in aggregated_substitutions:
            if not sub.get("is_equal_to_base"):
                changes_per_group[sub["group_id"]] += 1
                if _is_auto_publishable_sub(sub):
                    explicit_changes_per_group[sub["group_id"]] += 1
        for canc in aggregated_cancelled:
            changes_per_group[canc["group_id"]] += 1

        total_changes = sum(changes_per_group.values())
        total_explicit_changes = sum(explicit_changes_per_group.values())

        import_settings = await get_import_settings(db)
        is_anomaly = False
        anomaly_reasons = []

        # Safety Guard 4: No duplicates & no noise
        auto_publish_substitutions = [
            s for s in aggregated_substitutions
            if _is_auto_publishable_sub(s)
        ]

        aggregated_base_slots, restored_base_slots = _restore_base_slots_under_substitutions(
            aggregated_base_slots, aggregated_substitutions, current_schedules
        )

        payload = {
            "base_version_id": import_version_id,
            "base_slots": aggregated_base_slots,
            "substitutions": aggregated_substitutions,
            "cancelled": aggregated_cancelled,
            "import_scope": {
                "dates": sorted(imported_dates),
                "group_ids": sorted(imported_group_ids),
            },
            "created_curriculum_ids": [],
            "is_anomaly": is_anomaly,
            "anomaly_reasons": anomaly_reasons,
            "changes_count": total_changes,
            "explicit_changes_count": total_explicit_changes,
        }
        payload_hash = import_payload_hash(payload)

        debug_report = {
            "pages_fetched": len(page_snapshots),
            "unique_page_urls": len(seen_page_urls),
            "unique_page_hashes": len(seen_page_hashes),
            "raw_lessons": raw_lessons,
            "raw_base_slots": raw_base_slots,
            "raw_substitutions": raw_substitutions,
            "raw_cancelled": raw_cancelled,
            "final_substitutions": len(aggregated_substitutions),
            "final_explicit_substitutions": len(auto_publish_substitutions),
            "final_cancelled": len(aggregated_cancelled),
            "skipped_manual_count": len(skipped_manual),
            "skipped_reverted_count": len(skipped_reverted),
            "out_of_version_count": len(out_of_version_items),
            "page_snapshots": page_snapshots,
        }

        # Check against previous active publication
        last_pub = await db.scalar(
            select(SchedulePublication)
            .where(SchedulePublication.is_reverted.is_(False))
            .order_by(SchedulePublication.id.desc())
            .limit(1)
        )
        last_pub_manifest = {}
        last_pub_fp = {}
        last_pub_dates: set[date] = set()
        last_pub_groups: set[int] = set()
        if last_pub:
            try:
                if last_pub.scope_manifest:
                    last_pub_manifest = json.loads(last_pub.scope_manifest)
                if last_pub.source_fingerprint:
                    last_pub_fp = json.loads(last_pub.source_fingerprint)
            except Exception:
                pass
            for d_str in last_pub_manifest.get("dates", []):
                try:
                    last_pub_dates.add(datetime.strptime(d_str, "%Y-%m-%d").date())
                except Exception:
                    pass
            last_pub_groups = set(last_pub_manifest.get("group_ids", []))

        effective_check_dates = scope_dates_obj | last_pub_dates
        effective_check_groups = imported_group_ids | last_pub_groups

        latest_changes = [
            item for item in await _latest_published_changes(db, effective_check_dates, effective_check_groups)
            if item.kind == "substitution"
        ]
        incoming_changes_records = _canonical_change_records(auto_publish_substitutions, [])
        published_changes_records = [_change_payload(item) for item in latest_changes]
        db_changes_match = (
            import_changes_hash({"changes": incoming_changes_records})
            == import_changes_hash({"changes": published_changes_records})
        )

        last_pub_matches = False
        if last_pub:
            prev_payload_hash = last_pub_fp.get("payload_hash")
            if prev_payload_hash and prev_payload_hash == payload_hash:
                last_pub_matches = True
            elif not auto_publish_substitutions and last_pub_manifest.get("changes_count") == 0:
                last_pub_matches = True
            else:
                last_pub_changes = (await db.scalars(
                    select(ImportedScheduleChange).where(
                        ImportedScheduleChange.publication_id == last_pub.id,
                        ImportedScheduleChange.kind == "substitution",
                    )
                )).all()
                if last_pub_changes:
                    last_pub_records = [_change_payload(item) for item in last_pub_changes]
                    if import_changes_hash({"changes": incoming_changes_records}) == import_changes_hash({"changes": last_pub_records}):
                        last_pub_matches = True
            if not last_pub_matches and db_changes_match:
                prev_page_hashes = last_pub_fp.get("page_hashes")
                if prev_page_hashes and group_page_hashes and prev_page_hashes == group_page_hashes:
                    last_pub_matches = True

        unchanged = db_changes_match or last_pub_matches

        pending_stmt = (
            select(ScheduleDraft)
            .where(
                ScheduleDraft.draft_type == "import",
                ScheduleDraft.status == "pending",
            )
            .order_by(ScheduleDraft.id.desc())
            .limit(1)
        )
        pending_draft = await db.scalar(pending_stmt)
        pending_matches = (
            pending_draft
            and (
                import_payload_hash(pending_draft.data or {}) == payload_hash
            )
        )
        current_matches = await matches_published_schedule(db, payload, weeks)
        auto_publish_unchanged = unchanged or current_matches or last_pub_matches

        auto_published = False
        publication_id = None
        draft_id = None
        draft_reason = None
        auto_publish_skipped_reason = None

        if not import_settings.get("auto_publish", True):
            auto_publish_skipped_reason = "disabled"
        elif is_anomaly:
            auto_publish_skipped_reason = "anomaly"
        elif auto_publish_unchanged:
            auto_publish_skipped_reason = "unchanged"

        if import_settings["auto_publish"] and not is_anomaly:
            if auto_publish_unchanged:
                logger.info("Import payload identical to currently published schedule. Skipping publication.")
                unchanged = True
                old_pending = (await db.scalars(
                    select(ScheduleDraft).where(
                        ScheduleDraft.draft_type == "import",
                        ScheduleDraft.status == "pending",
                    )
                )).all()
                for d in old_pending:
                    d.status = "archived"
                await settings_service.set(
                    db,
                    "import_last_check_status",
                    json.dumps({
                        "checked_at": now_local().isoformat(),
                        "source": "Вручну" if actor_id is not None else "Авто",
                        "status": "unchanged",
                        "changes_count": 0,
                    }),
                )
                await db.commit()
            else:
                # Auto-publish immediately: only explicit substitutions and same-day swaps/moves (no cancellations)
                auto_published = True
                unchanged = False
                source_label = "manual" if actor_id is not None else "auto"
                published_count = len(auto_publish_substitutions)

                await _sync_postgres_sequences(
                    db,
                    ("schedule_publications", "schedule_publication_snapshots", "imported_schedule_changes", "schedule_drafts", "schedule_slots", "schedule_override")
                )

                publication = SchedulePublication(
                    version_id=import_version_id,
                    actor_id=actor_id,
                    scope_manifest=json.dumps({
                        "source": source_label,
                        "group_ids": sorted(list(imported_group_ids)),
                        "changes_count": published_count,
                        "dates": sorted(list(imported_dates)),
                    }),
                    source_fingerprint=json.dumps({
                        "source_type": source_label,
                        "page_hashes": group_page_hashes,
                        "payload_hash": payload_hash,
                    }),
                )
                db.add(publication)
                await db.flush()
                publication_id = publication.id

                retire_dates = scope_dates_obj | last_pub_dates
                retire_groups = imported_group_ids | last_pub_groups
                if retire_dates and retire_groups:
                    await db.execute(
                        update(ImportedScheduleChange)
                        .where(
                            ImportedScheduleChange.is_published.is_(True),
                            ImportedScheduleChange.kind == "substitution",
                            ImportedScheduleChange.date.in_(retire_dates),
                            ImportedScheduleChange.group_id.in_(retire_groups),
                            ImportedScheduleChange.manually_edited.is_(False),
                        )
                        .values(is_published=False)
                    )

                for sub in auto_publish_substitutions:
                    d_obj = datetime.strptime(sub["date"], "%Y-%m-%d").date()
                    latest = await db.scalar(
                        select(func.max(ImportedScheduleChange.version)).where(
                            ImportedScheduleChange.date == d_obj,
                            ImportedScheduleChange.group_id == sub["group_id"],
                            ImportedScheduleChange.lesson_number == sub["lesson_number"],
                        )
                    )
                    db.add(ImportedScheduleChange(
                        publication_id=publication.id,
                        date=d_obj,
                        kind="substitution",
                        change_type=sub.get("change_type", "substitution"),
                        group_id=sub["group_id"],
                        subject_id=sub.get("subject_id"),
                        teacher_id=sub.get("teacher_id"),
                        second_teacher_id=sub.get("second_teacher_id"),
                        lesson_number=sub["lesson_number"],
                        room_override=sub.get("room"),
                        is_published=True,
                        version=(latest or 0) + 1,
                    ))

                    dow = d_obj.isoweekday()
                    w_type = get_week_type(d_obj, semester_start)
                    base_p = next((
                        s for s in current_schedules
                        if s.group_id == sub["group_id"] and s.day_of_week == dow and s.lesson_number == sub["lesson_number"] and _week_matches(w_type, s.week_type)
                    ), None)
                    before_str = "Немає пари"
                    if base_p:
                        subj_name = base_p.subject.name if base_p.subject else ""
                        teach_name = base_p.teacher.name if base_p.teacher else ""
                        room_str = f", ауд. {base_p.room_override}" if base_p.room_override else ""
                        before_str = f"{subj_name} ({teach_name}{room_str})".strip()
                    new_subj = subjects_map.get(sub.get("subject_id"))
                    new_teach = teachers_map.get(sub.get("teacher_id"))
                    new_room = f", ауд. {sub.get('room')}" if sub.get("room") else ""
                    summary_str = f"{new_subj.name if new_subj else ''} ({new_teach.name if new_teach else ''}{new_room})".strip()
                    if sub.get("is_swap") and sub.get("swap_with_lesson"):
                        summary_str += f" [🔀 Перестановка: пара {sub['lesson_number']} ↔ пара {sub['swap_with_lesson']}]"
                    elif sub.get("is_move") and sub.get("moved_from_lesson"):
                        summary_str += f" [➡️ Перенесено з {sub['moved_from_lesson']}-ї пари]"
                    elif sub.get("is_explicit_substitution"):
                        summary_str += " [🏷️ Заміна]"

                    db.add(SchedulePublicationSnapshot(
                        publication_id=publication.id,
                        group_id=sub["group_id"],
                        date=d_obj,
                        lesson_number=sub["lesson_number"],
                        before_data=json.dumps({"summary": before_str}),
                        after_data=json.dumps({
                            "kind": "substitution",
                            "change_type": sub.get("change_type", "substitution"),
                            "summary": summary_str,
                            "is_swap": sub.get("is_swap", False),
                            "swap_with_lesson": sub.get("swap_with_lesson"),
                            "is_move": sub.get("is_move", False),
                            "moved_from_lesson": sub.get("moved_from_lesson"),
                        }),
                    ))

                old_pending = (await db.scalars(
                    select(ScheduleDraft).where(
                        ScheduleDraft.draft_type == "import",
                        ScheduleDraft.status == "pending",
                    )
                )).all()
                for d in old_pending:
                    d.status = "archived"

                if aggregated_cancelled:
                    cancellation_draft = ScheduleDraft(
                        name=f"Скасування пар з імпорту {now_local().strftime('%Y-%m-%d %H:%M')}",
                        draft_type="import",
                        status="pending",
                        data={
                            "base_version_id": import_version_id,
                            "base_slots": [],
                            "substitutions": [],
                            "cancelled": aggregated_cancelled,
                            "import_scope": payload["import_scope"],
                            "is_anomaly": False,
                            "anomaly_reasons": [],
                            "changes_count": len(aggregated_cancelled),
                            "auto_publish_skipped_reason": "cancellations_require_review",
                        },
                    )
                    db.add(cancellation_draft)

                today = now_local().date()
                tomorrow = today + timedelta(days=1)
                urgent = any(
                    datetime.strptime(item["date"], "%Y-%m-%d").date() in (today, tomorrow)
                    for item in auto_publish_substitutions
                )
                swaps_count = sum(
                    1 for item in auto_publish_substitutions
                    if item.get("is_swap") or item.get("change_type") == "swap"
                )
                replacements_count = len(auto_publish_substitutions) - swaps_count
                dates_list = sorted(list({item["date"] for item in auto_publish_substitutions}))
                notif_data = {
                    "id": str(uuid.uuid4()),
                    "publication_id": publication.id,
                    "source": source_label,
                    "created_at": now_local().isoformat(),
                    "changes_count": published_count,
                    "replacements_count": replacements_count,
                    "swaps_count": swaps_count,
                    "dates": dates_list,
                    "urgent": urgent,
                    "dismissed": False,
                }
                await settings_service.set(db, "import_latest_notification", json.dumps(notif_data))
                await settings_service.set(
                    db,
                    "import_last_check_status",
                    json.dumps({
                        "checked_at": now_local().isoformat(),
                        "source": "Вручну" if actor_id is not None else "Авто",
                        "status": "published",
                        "changes_count": published_count,
                        "publication_id": publication.id,
                    }),
                )

                await db.commit()
                settings_service.invalidate_cache()
        else:
            # Either auto_publish is False or an anomaly was detected: use draft model
            await _sync_postgres_sequences(db, ("schedule_drafts", "schedule_slots"))

            async def archive_pending_import() -> None:
                if not pending_draft:
                    return
                await db.execute(delete(ScheduleSlot).where(ScheduleSlot.draft_id == pending_draft.id))
                created_ids = (pending_draft.data or {}).get("created_curriculum_ids", [])
                if created_ids:
                    await db.execute(delete(Curriculum).where(Curriculum.id.in_(created_ids)))
                pending_draft.status = "archived"

            if pending_matches:
                pending_draft.data = {
                    **(pending_draft.data or {}),
                    "import_scope": payload["import_scope"],
                    "auto_publish_skipped_reason": auto_publish_skipped_reason,
                    "anomaly_reasons": anomaly_reasons,
                }
                pending_draft.revision += 1
                await settings_service.set(
                    db,
                    "import_last_check_status",
                    json.dumps({
                        "checked_at": now_local().isoformat(),
                        "source": "Вручну" if actor_id is not None else "Авто",
                        "status": "anomaly" if is_anomaly else "draft",
                        "changes_count": total_explicit_changes if is_anomaly else total_changes,
                    }),
                )
                await db.commit()
                draft_id = pending_draft.id
                unchanged = False
                draft_reason = "same_pending_payload"
            elif current_matches:
                logger.info("Import payload identical to currently published schedule. Skipping creation.")
                await settings_service.set(
                    db,
                    "import_last_check_status",
                    json.dumps({
                        "checked_at": now_local().isoformat(),
                        "source": "Вручну" if actor_id is not None else "Авто",
                        "status": "unchanged",
                        "changes_count": 0,
                    }),
                )
                await db.commit()
                draft_id = None
                unchanged = True
                draft_reason = "same_effective_schedule"
            else:
                if pending_draft:
                    await archive_pending_import()
                draft_name = (
                    f"Аномальний імпорт {now_local().strftime('%Y-%m-%d %H:%M')}"
                    if is_anomaly
                    else f"Імпорт {now_local().strftime('%Y-%m-%d %H:%M')}"
                )
                payload["auto_publish_skipped_reason"] = auto_publish_skipped_reason
                payload["anomaly_reasons"] = anomaly_reasons
                draft = ScheduleDraft(
                    name=draft_name,
                    draft_type="import",
                    status="pending",
                    data=payload,
                )
                db.add(draft)
                await db.flush()
                draft_id = draft.id
                draft.revision += 1
                await settings_service.set(
                    db,
                    "import_last_check_status",
                    json.dumps({
                        "checked_at": now_local().isoformat(),
                        "source": "Вручну" if actor_id is not None else "Авто",
                        "status": "anomaly" if is_anomaly else "draft",
                        "changes_count": total_explicit_changes if is_anomaly else total_changes,
                    }),
                )
                await db.commit()
                draft_reason = "anomaly_detected" if is_anomaly else "draft_created"

        if main_page_hash:
            try:
                await settings_service.set(db, "import_last_main_page_hash", main_page_hash)
                await db.commit()
            except Exception:
                pass

        set_active_jobs(0)
        record_successful_import()
        return {
            "status": "anomaly_draft" if is_anomaly else "success",
            "groups_processed": len(group_ids),
            "groups_ok": len(imported_group_ids),
            "groups_failed": len(set(e.get("group") for e in errors if e.get("group") is not None)),
            "substitutions_found": len(aggregated_substitutions) + len(aggregated_unresolved_subs),
            "substitutions_saved": len(aggregated_substitutions),
            "substitutions_updated": 0,
            "substitutions_unresolved": len(aggregated_unresolved_subs),
            "substitutions_orphaned": 0,
            "errors": errors,
            "report": {
                "unresolved": list(aggregated_unresolved.values()),
                "unresolved_substitutions": aggregated_unresolved_subs,
                "substitutions": aggregated_substitutions,
                "cancelled": aggregated_cancelled,
                "base_slots": aggregated_base_slots,
                "skipped_base_slots": aggregated_skipped,
                "restored_base_slots": restored_base_slots,
                "skipped_manual": skipped_manual,
                "skipped_reverted": skipped_reverted,
                "out_of_version": out_of_version_items,
                "anomaly_reasons": anomaly_reasons,
                "debug": debug_report,
            },
            "meta": {
                "draft_created": draft_id,
                "publication_id": publication_id,
                "unchanged": unchanged,
                "auto_published": auto_published,
                "is_anomaly": is_anomaly,
                "anomaly_reasons": anomaly_reasons,
                "auto_publish_skipped_reason": auto_publish_skipped_reason,
                "reason": (
                    draft_reason if draft_reason
                    else ("same_effective_schedule" if unchanged
                    else ("auto_published" if auto_published else "draft_created"))
                ),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Import error [{error_id}]: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "msg": f"Внутрішня помилка імпорту: {e}",
                "error_id": error_id,
                "trace": traceback.format_exc().splitlines()[-10:],
            },
        )
    finally:
        set_active_jobs(0)
