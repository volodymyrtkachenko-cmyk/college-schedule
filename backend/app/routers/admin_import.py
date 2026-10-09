from fastapi import Request
from app.config import settings
import httpx
import asyncio
import hashlib
import json
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Security, Header, BackgroundTasks
from fastapi.security.api_key import APIKeyHeader
from sqlalchemy import text, delete, select, func
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db, engine
from app.services.import_lock import import_mutex
from app.routers.auth import limiter
from app.core.security import require_roles
from app.core.time import now_local
from app.services.importer.fetcher import ScheduleFetcher
from app.services.importer.parsers.kre_parser import KREParser
from app.services.importer.normalizer import EntityNormalizer
from app.services.importer.differ import ScheduleDiffer
from app.routers.drafts import publish_draft
from app.analytics import set_active_jobs, record_successful_import
from app.services.import_slot_safety import normalize_base_slots, version_for_import
from app.models import ScheduleDraft, ScheduleSlot, Curriculum, Schedule, ImportedScheduleChange
import traceback
from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])
IMPORT_PAGE_RETRIES = 3




def hash_payload(payload: dict) -> str:
    serialized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def import_payload_hash(payload: dict) -> str:
    comparable = {
        key: value
        for key, value in payload.items()
        if key not in {"created_curriculum_ids", "import_scope"}
    }
    for key in ("base_slots", "substitutions", "cancelled"):
        values = comparable.get(key)
        if isinstance(values, list):
            if key in {"substitutions", "cancelled"}:
                values = [
                    {field: value for field, value in item.items() if field != "kind"}
                    if isinstance(item, dict) else item
                    for item in values
                ]
            comparable[key] = sorted(
                values,
                key=lambda value: json.dumps(value, sort_keys=True, default=str),
            )
    return hash_payload(comparable)


def import_changes_hash(payload: dict) -> str:
    if "changes" in payload:
        records = payload["changes"]
    else:
        records = _canonical_change_records(
            payload.get("substitutions", []),
            payload.get("cancelled", []),
        )
    return hash_payload({"changes": records})


def _canonical_change_records(
    substitutions: list[dict],
    cancelled: list[dict],
) -> list[dict]:
    records = [
        {
            "date": item["date"],
            "lesson_number": item["lesson_number"],
            "group_id": item["group_id"],
            "subject_id": item.get("subject_id"),
            "teacher_id": item.get("teacher_id"),
            "second_teacher_id": item.get("second_teacher_id"),
            "room": _normalize_room(item.get("room")),
            "kind": "substitution",
        }
        for item in substitutions
    ]
    records.extend(
        {
            "date": item["date"],
            "lesson_number": item["lesson_number"],
            "group_id": item["group_id"],
            "subject_id": None,
            "teacher_id": None,
            "second_teacher_id": None,
            "room": None,
            "kind": "cancelled",
        }
        for item in cancelled
    )
    return sorted(
        records,
        key=lambda item: json.dumps(item, sort_keys=True, default=str),
    )


def _change_payload(change: ImportedScheduleChange) -> dict:
    return {
        "date": change.date.isoformat(),
        "lesson_number": change.lesson_number,
        "group_id": change.group_id,
        "subject_id": change.subject_id,
        "teacher_id": change.teacher_id,
        "second_teacher_id": change.second_teacher_id,
        "room": _normalize_room(change.room_override),
        "kind": change.kind,
    }


def _week_matches(incoming: str, existing: str) -> bool:
    return incoming == "both" or incoming == existing or existing == "both"


def _normalize_room(value: str | None) -> str:
    normalized = " ".join((value or "").casefold().split())
    for prefix in ("аудиторія ", "ауд. ", "ауд "):
        if normalized.startswith(prefix):
            return normalized[len(prefix):].strip()
    return normalized


def _schedule_room(schedule: Schedule) -> str | None:
    return schedule.room_override or getattr(schedule.teacher, "room", None)


def _slot_matches(incoming: dict, existing: Schedule) -> bool:
    if (
        incoming["group_id"] != existing.group_id
        or incoming["subject_id"] != existing.subject_id
        or incoming["teacher_id"] != existing.teacher_id
        or incoming.get("second_teacher_id") != existing.second_teacher_id
        or incoming["day_of_week"] != existing.day_of_week
        or incoming["lesson_number"] != existing.lesson_number
        or not _week_matches(incoming.get("week_type", "both"), existing.week_type)
    ):
        return False
    incoming_room = _normalize_room(incoming.get("room"))
    return not incoming_room or incoming_room == _normalize_room(_schedule_room(existing))


def _substitution_matches_schedule(substitution: dict, schedules: list[Schedule]) -> bool:
    day_of_week = datetime.strptime(substitution["date"], "%Y-%m-%d").isoweekday()
    for schedule in schedules:
        if (
            schedule.group_id == substitution["group_id"]
            and schedule.day_of_week == day_of_week
            and schedule.lesson_number == substitution["lesson_number"]
            and schedule.subject_id == substitution["subject_id"]
            and schedule.teacher_id == substitution["teacher_id"]
            and schedule.second_teacher_id == substitution.get("second_teacher_id")
            and _week_matches(substitution.get("week_type", "both"), schedule.week_type)
        ):
            imported_room = _normalize_room(substitution.get("room"))
            if not imported_room or imported_room == _normalize_room(_schedule_room(schedule)):
                return True
    return False


def _cancellation_matches_schedule(cancellation: dict, schedules: list[Schedule]) -> bool:
    day_of_week = datetime.strptime(cancellation["date"], "%Y-%m-%d").isoweekday()
    return any(
        schedule.group_id == cancellation["group_id"]
        and schedule.day_of_week == day_of_week
        and schedule.lesson_number == cancellation["lesson_number"]
        and _week_matches(cancellation.get("week_type", "both"), schedule.week_type)
        for schedule in schedules
    )


def _deduplicate_import_changes(
    substitutions: list[dict],
    cancelled: list[dict],
) -> tuple[list[dict], list[dict]]:
    substitution_by_cell: dict[tuple[str, int, int], dict] = {}
    for item in substitutions:
        key = (item["date"], item["group_id"], item["lesson_number"])
        current = substitution_by_cell.get(key)
        candidate = {
            **item,
            "room": _normalize_room(item.get("room")),
            "week_type": item.get("week_type", "both"),
        }
        if current is None or json.dumps(candidate, sort_keys=True, default=str) < json.dumps(
            current, sort_keys=True, default=str
        ):
            substitution_by_cell[key] = candidate

    cancelled_by_cell: dict[tuple[str, int, int], dict] = {}
    for item in cancelled:
        key = (item["date"], item["group_id"], item["lesson_number"])
        cancelled_by_cell[key] = {
            **item,
            "week_type": item.get("week_type", "both"),
        }

    # A cancellation is the effective state of a cell and must not coexist
    # with a substitution for the same date/group/lesson.
    for key in cancelled_by_cell:
        substitution_by_cell.pop(key, None)

    return (
        sorted(substitution_by_cell.values(), key=lambda item: (item["date"], item["group_id"], item["lesson_number"])),
        sorted(cancelled_by_cell.values(), key=lambda item: (item["date"], item["group_id"], item["lesson_number"])),
    )


async def _latest_published_changes(
    db: AsyncSession,
    scope_dates: set,
    scope_groups: set[int],
) -> list[ImportedScheduleChange]:
    changes = (await db.scalars(
        select(ImportedScheduleChange).where(
            ImportedScheduleChange.is_published.is_(True),
            ImportedScheduleChange.date.in_(scope_dates),
            ImportedScheduleChange.group_id.in_(scope_groups) if scope_groups else True,
        )
    )).all()
    latest_changes: dict[tuple[object, int, int], ImportedScheduleChange] = {}
    for change in changes:
        key = (change.date, change.group_id, change.lesson_number)
        previous = latest_changes.get(key)
        if previous is None or change.version > previous.version:
            latest_changes[key] = change
    return list(latest_changes.values())


async def matches_published_schedule(db: AsyncSession, payload: dict, weeks: int) -> bool:
    schedules = (await db.scalars(
        select(Schedule)
        .where(Schedule.is_active.is_(True))
        .options(joinedload(Schedule.teacher))
    )).all()
    if "base_version_id" in payload:
        version_id = payload["base_version_id"]
        schedules = [s for s in schedules if s.version_id == version_id]
    used_schedule_ids: set[int] = set()
    for incoming in payload.get("base_slots", []):
        match = next(
            (
                schedule for schedule in schedules
                if schedule.id not in used_schedule_ids and _slot_matches(incoming, schedule)
            ),
            None,
        )
        if match is None:
            return False
        used_schedule_ids.add(match.id)

    scope = payload.get("import_scope") or {}
    scope_dates = {
        datetime.strptime(value, "%Y-%m-%d").date()
        for value in scope.get("dates", [])
    }
    if not scope_dates:
        today = now_local().date()
        scope_dates = {today + timedelta(days=offset) for offset in range(max(weeks, 1) * 7)}
    scope_groups = set(scope.get("group_ids", []))
    latest_changes = await _latest_published_changes(db, scope_dates, scope_groups)

    incoming_changes = _canonical_change_records(
        payload.get("substitutions", []),
        payload.get("cancelled", []),
    )
    published_changes = [_change_payload(item) for item in latest_changes]
    return import_changes_hash({"changes": incoming_changes}) == import_changes_hash(
        {"changes": published_changes}
    )

@router.post("/import")
async def trigger_import(
    request: Request,
    weeks: int = Query(2, ge=1, le=4, description="Number of weeks to fetch"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin"))
):
    logger.info("Manual import accepted: actor=%s weeks=%s", user.id, weeks)
    return await execute_import_logic(db, weeks)

async def execute_import_logic(db: AsyncSession, weeks: int = 2):
    if not 1 <= weeks <= 4:
        raise HTTPException(422, "Weeks must be between 1 and 4")
    import uuid
    error_id = str(uuid.uuid4())
    try:
        async with import_mutex(engine, error_id):
            return await _do_import(db, weeks, error_id)
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

async def _do_import(db: AsyncSession, weeks: int, error_id: str):
    
    fetcher = ScheduleFetcher()
    parser = KREParser()
    try:
        normalizer = EntityNormalizer(db)
        await normalizer.load_dictionaries()
        differ = ScheduleDiffer(db, normalizer)

        group_ids = await fetcher.get_all_group_ids()
        if not group_ids:
            raise HTTPException(502, detail={"code":"empty_import_group_list", "msg":"Джерело не повернуло групи. Імпорт зупинено."})
        
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
        raw_lessons = 0
        
        semaphore = asyncio.Semaphore(5)
        
        async def fetch_and_parse(client, g_id):
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
                                    await asyncio.sleep(0.5 * (attempt + 1))
                        if html is None:
                            raise last_error or RuntimeError("Unable to fetch import page")
                        page_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
                        if page_hash in visited_hashes:
                            logger.warning("Skipping repeated import page hash for group %s: %s", g_id, url)
                            break
                        visited_hashes.add(page_hash)
                        parsed = parser.parse(html)
                        parsed_results.append((parsed, url, page_hash))
                        
                        # Find next week link
                        from selectolax.parser import HTMLParser
                        tree = HTMLParser(html)
                        next_week_node = tree.css_first("a[aria-label='Наступний тиждень']")
                        if next_week_node:
                            href = next_week_node.attributes.get("href")
                            if href:
                                if not href.startswith("http"):
                                    href = "https://kre.dp.ua" + (href if href.startswith("/") else f"/{href}")
                                url = href
                            else:
                                break
                        else:
                            break
                    except Exception as e:
                        logger.error(f"Error parsing group {g_id} at {url}: {e}")
                        errors.append({"group": g_id, "url": url, "error": str(e)})
                        break
                        
                return parsed_results

        scraped_weeks = set()
        async with httpx.AsyncClient(timeout=20.0) as client:
            tasks = [fetch_and_parse(client, g_id) for g_id in group_ids]
            parsed_weeks = await asyncio.gather(*tasks, return_exceptions=True)
            
            for g_idx, parsed_week_list in enumerate(parsed_weeks):
                if isinstance(parsed_week_list, Exception):
                    errors.append({"group": group_ids[g_idx], "error": str(parsed_week_list)})
                    continue
                for parsed_week in parsed_week_list:
                    parsed_week_obj, source_url, page_hash = parsed_week
                    scraped_weeks.add(parsed_week_obj.week_type)
                    page_snapshots.append({
                        "group_id": group_ids[g_idx],
                        "url": source_url,
                        "html_hash": page_hash,
                        "dates": sorted({lesson.date.isoformat() for lesson in parsed_week_obj.lessons}),
                        "week_type": parsed_week_obj.week_type,
                    })
                    seen_page_urls.add(source_url)
                    seen_page_hashes.add(page_hash)
                    raw_lessons += len(parsed_week_obj.lessons)
                    imported_dates.update(lesson.date.isoformat() for lesson in parsed_week_obj.lessons)
                    diff_report = await differ.diff(parsed_week_obj)
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

        if errors:
            failed_groups = sorted({
                error["group"]
                for error in errors
                if error.get("group") is not None
            })
            raise HTTPException(
                status_code=502,
                detail={
                    "message": "Імпорт перервано: не всі групи вдалося завантажити.",
                    "failed_groups": failed_groups,
                    "errors": errors,
                },
            )
                
        raw_base_slots = len(aggregated_base_slots)
        raw_substitutions = len(aggregated_substitutions)
        raw_cancelled = len(aggregated_cancelled)

        # Scope every restoration to one unambiguous version for source dates.
        import_version_id = await version_for_import(db, imported_dates, now_local().date())
        aggregated_base_slots = normalize_base_slots([{**slot, "room": _normalize_room(slot.get("room"))} for slot in aggregated_base_slots])

        current_schedules = (await db.scalars(
            select(Schedule)
            .where(Schedule.is_active.is_(True),
                   Schedule.version_id == import_version_id if import_version_id is not None else Schedule.version_id.is_(None))
            .options(joinedload(Schedule.subject), joinedload(Schedule.teacher))
        )).all()
        
        scope_dates_obj = {datetime.strptime(value, "%Y-%m-%d").date() for value in imported_dates}
        latest_changes = await _latest_published_changes(db, scope_dates_obj, imported_group_ids)
        aggregated_substitutions = [
            {**item, "is_new": not any(
                c.date.isoformat() == item["date"] and
                c.group_id == item["group_id"] and
                c.lesson_number == item["lesson_number"] and
                c.subject_id == item.get("subject_id") and
                c.teacher_id == item.get("teacher_id")
                for c in latest_changes
            )}
            for item in aggregated_substitutions
        ]
        aggregated_cancelled = [
            {**item, "is_new": not any(
                c.date.isoformat() == item["date"] and
                c.group_id == item["group_id"] and
                c.lesson_number == item["lesson_number"] and
                c.kind == "cancelled"
                for c in latest_changes
            )}
            for item in aggregated_cancelled
            if _cancellation_matches_schedule(item, current_schedules)
        ]
        filtered_substitutions = raw_substitutions - len(aggregated_substitutions)
        filtered_cancelled = raw_cancelled - len(aggregated_cancelled)
        aggregated_substitutions, aggregated_cancelled = _deduplicate_import_changes(
            aggregated_substitutions,
            aggregated_cancelled,
        )

        # Імпорт не повинен повертати вручну додані пари.
        scraped_both = "both" in scraped_weeks
        scraped_numerator = scraped_both or "numerator" in scraped_weeks
        scraped_denominator = scraped_both or "denominator" in scraped_weeks

        def covers(imported_week: str, existing_week: str) -> bool:
            return imported_week == "both" or imported_week == existing_week

        for sch in current_schedules:
            is_vyhovna = sch.day_of_week == 4 and sch.lesson_number == 4 and sch.subject and sch.subject.name.strip().casefold() == "виховна година"
            
            if sch.week_type == "numerator" and scraped_numerator and not is_vyhovna:
                continue
            if sch.week_type == "denominator" and scraped_denominator and not is_vyhovna:
                continue
            if sch.week_type == "both" and scraped_numerator and scraped_denominator and not is_vyhovna:
                continue
            matching_import = [
                slot
                for slot in aggregated_base_slots
                if (
                    slot["group_id"] == sch.group_id
                    and slot["day_of_week"] == sch.day_of_week
                    and slot["lesson_number"] == sch.lesson_number
                    and covers(slot["week_type"], sch.week_type)
                )
            ]
            if not matching_import:
                preserved_week = sch.week_type
                if sch.week_type == "both":
                    imported_same_cell = [
                        slot
                        for slot in aggregated_base_slots
                        if (
                            slot["group_id"] == sch.group_id
                            and slot["day_of_week"] == sch.day_of_week
                            and slot["lesson_number"] == sch.lesson_number
                        )
                    ]
                    if imported_same_cell and imported_same_cell[0]["week_type"] in {"numerator", "denominator"}:
                        preserved_week = (
                            "denominator"
                            if imported_same_cell[0]["week_type"] == "numerator"
                            else "numerator"
                        )
                    elif not imported_same_cell:
                        if scraped_denominator and not scraped_numerator:
                            preserved_week = "numerator"
                        elif scraped_numerator and not scraped_denominator:
                            preserved_week = "denominator"
                aggregated_base_slots.append({
                    "day_of_week": sch.day_of_week,
                    "lesson_number": sch.lesson_number,
                    "group_id": sch.group_id,
                    "subject_id": sch.subject_id,
                    "teacher_id": sch.teacher_id,
                    "second_teacher_id": sch.second_teacher_id,
                    "room": sch.room_override,
                    "week_type": preserved_week,
                })
        
        # На сайті на місці заміни оригінальної пари немає. Відновлюємо її з поточного
        # опублікованого розкладу, щоб у базовому розкладі не лишалось «дірок».
        restored_base_slots = []
        for sub in aggregated_substitutions:
            dow = datetime.strptime(sub["date"], "%Y-%m-%d").isoweekday()
            sub_week = sub.get("week_type", "both")
            same_cell = [
                s for s in aggregated_base_slots
                if s["group_id"] == sub["group_id"] and s["day_of_week"] == dow and s["lesson_number"] == sub["lesson_number"]
            ]
            if any(s["week_type"] in ("both", sub_week) or sub_week == "both" for s in same_cell):
                continue
            published = (await db.scalars(select(Schedule).where(
                Schedule.group_id == sub["group_id"],
                Schedule.day_of_week == dow,
                Schedule.lesson_number == sub["lesson_number"],
                Schedule.is_active.is_(True),
                Schedule.week_type.in_(("both", sub_week)),
                Schedule.version_id == import_version_id if import_version_id is not None else Schedule.version_id.is_(None),
            ))).all()
            for sch in published:
                slot = {
                    "day_of_week": dow,
                    "lesson_number": sub["lesson_number"],
                    "group_id": sub["group_id"],
                    "subject_id": sch.subject_id,
                    "teacher_id": sch.teacher_id,
                    "second_teacher_id": sch.second_teacher_id,
                    "room": sch.room_override,
                    # Якщо в іншому тижні в цій клітинці вже є пара, відновлюємо лише для тижня заміни.
                    "week_type": sub_week if same_cell else sch.week_type,
                }
                aggregated_base_slots.append(slot)
                restored_base_slots.append(slot)
                same_cell = [*same_cell, slot]

        before_final_normalization = len(aggregated_base_slots)
        aggregated_base_slots = normalize_base_slots([{**slot, "room": _normalize_room(slot.get("room"))} for slot in aggregated_base_slots])
        restored_base_slots = normalize_base_slots([{**slot, "room": _normalize_room(slot.get("room"))} for slot in restored_base_slots])

        # Prepare payload for Draft Data
        created_curriculum_ids: list[int] = []
        payload = {
            "base_version_id": import_version_id,
            "base_slots": aggregated_base_slots,
            "substitutions": aggregated_substitutions,
            "cancelled": aggregated_cancelled,
            "import_scope": {
                "dates": sorted(imported_dates),
                "group_ids": sorted(imported_group_ids),
            },
            "created_curriculum_ids": created_curriculum_ids,
        }
        payload_hash = import_payload_hash(payload)
        debug_report = {
            "base_slots_collapsed": before_final_normalization - len(aggregated_base_slots),
            "pages_fetched": len(page_snapshots),
            "unique_page_urls": len(seen_page_urls),
            "unique_page_hashes": len(seen_page_hashes),
            "raw_lessons": raw_lessons,
            "raw_base_slots": raw_base_slots,
            "raw_substitutions": raw_substitutions,
            "raw_cancelled": raw_cancelled,
            "deduplicated_base_slots": len(aggregated_base_slots),
            "deduplicated_substitutions": len(aggregated_substitutions),
            "deduplicated_cancelled": len(aggregated_cancelled),
            "filtered_substitutions": filtered_substitutions,
            "filtered_cancelled": filtered_cancelled,
            "final_substitutions": len(aggregated_substitutions),
            "final_cancelled": len(aggregated_cancelled),
            "page_snapshots": page_snapshots,
        }
        
        # A pending import is only active until the next source snapshot is
        # evaluated. Once the same snapshot is seen again, it is stale and
        # must not reappear after reload as a new set of changes.
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

        unchanged = False
        is_auto_published = False
        pending_matches = (
            pending_draft
            and (
                import_payload_hash(pending_draft.data or {}) == payload_hash
            )
        )
        current_matches = await matches_published_schedule(db, payload, weeks)

        async def archive_pending_import() -> None:
            if not pending_draft:
                return
            await db.execute(delete(ScheduleSlot).where(ScheduleSlot.draft_id == pending_draft.id))
            created_ids = (pending_draft.data or {}).get("created_curriculum_ids", [])
            if created_ids:
                await db.execute(delete(Curriculum).where(Curriculum.id.in_(created_ids)))
            pending_draft.status = "archived"

        if pending_matches:
            pending_draft.data = {**(pending_draft.data or {}), "import_scope": payload["import_scope"]}
            pending_draft.revision += 1
            await db.commit()
            draft_id = pending_draft.id
            unchanged = False
        elif current_matches:
            logger.info("Import payload identical to the latest import. Skipping creation.")
            await db.commit()
            draft_id = None
            unchanged = True
        else:
            if pending_draft:
                await archive_pending_import()
            draft_name = f"Імпорт {now_local().strftime('%Y-%m-%d %H:%M')}"
            draft = ScheduleDraft(name=draft_name, draft_type="import", status="pending", data=payload)
            db.add(draft)
            await db.flush()
            draft_id = draft.id
            
            # Save Base Slots
            for slot in aggregated_base_slots:
                stmt_c = select(Curriculum).where(
                    Curriculum.group_id == slot["group_id"],
                    Curriculum.subject_id == slot["subject_id"]
                )
                if slot["teacher_id"]:
                    stmt_c = stmt_c.where(Curriculum.teacher_id == slot["teacher_id"])
                if slot.get("second_teacher_id"):
                    stmt_c = stmt_c.where(Curriculum.second_teacher_id == slot["second_teacher_id"])
                
                curr = await db.scalar(stmt_c)
                if not curr:
                    curr = Curriculum(
                        group_id=slot["group_id"],
                        subject_id=slot["subject_id"],
                        teacher_id=slot["teacher_id"] or 1,
                        second_teacher_id=slot.get("second_teacher_id"),
                        pairs_per_2_weeks=2,
                        total_hours=0
                    )
                    db.add(curr)
                    await db.flush()
                    created_curriculum_ids.append(curr.id)
                
                db_slot = ScheduleSlot(
                    draft_id=draft.id,
                    curriculum_id=curr.id,
                    day_of_week=slot["day_of_week"],
                    lesson_number=slot["lesson_number"],
                    room_override=slot["room"],
                    week_type=slot.get("week_type", "both")
                )
                db.add(db_slot)
                
            
            draft.data = {**payload, "created_curriculum_ids": created_curriculum_ids}
            draft.revision += 1
            await db.commit()

            
        set_active_jobs(0)
        record_successful_import()
        return {
            "status": "success", 
            "groups_processed": len(group_ids),
            "groups_ok": len(group_ids) - len(set(e["group"] for e in errors)),
            "groups_failed": len(set(e["group"] for e in errors)),
            "substitutions_found": len(aggregated_substitutions) + len(aggregated_unresolved_subs),
            "substitutions_saved": len(aggregated_substitutions),
            "substitutions_updated": 0, # Pending draft stores them
            "substitutions_unresolved": len(aggregated_unresolved_subs),
            "substitutions_orphaned": 0,
            "errors": errors,
            "report": {
                "unresolved": list(aggregated_unresolved.values()),
                "unresolved_substitutions": aggregated_unresolved_subs,
                "substitutions": aggregated_substitutions,
                "base_slots": aggregated_base_slots,
                "skipped_base_slots": aggregated_skipped,
                "restored_base_slots": restored_base_slots,
                "debug": debug_report,
            },
            
            "meta": {
                "draft_created": draft_id,
                "unchanged": unchanged,
                "auto_published": is_auto_published,

                "reason": "same_pending_payload" if pending_matches else (
                    "same_effective_schedule" if unchanged else "draft_created"
                ),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Import error [{error_id}]: {e}", exc_info=True)
        set_active_jobs(0)
        raise HTTPException(status_code=500, detail={"msg": "Внутрішня помилка імпорту. Зверніться до підтримки.", "error_id": error_id})



@router.post("/import/cron")
@limiter.limit("3/hour")
async def import_data_cron(
    request: Request,
    db: AsyncSession = Depends(get_db),
    cron_key: str | None = Header(None, alias="X-Cron-Key")
):
    import_secret = getattr(settings, "IMPORT_CRON_SECRET", None)
    if not import_secret or not cron_key:
        logger.warning("Cron import denied: missing configuration or key")
        raise HTTPException(status_code=401, detail="Unauthorized cron")
    
    import hmac
    if not hmac.compare_digest(cron_key.encode(), import_secret.encode()):
        logger.warning("Cron import denied: invalid key")
        raise HTTPException(status_code=401, detail="Unauthorized cron")
        
    logger.info("Cron import accepted")
    return await execute_import_logic(db, 2)
