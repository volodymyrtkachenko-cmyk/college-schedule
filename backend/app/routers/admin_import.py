from fastapi import Request
from app.config import settings
import httpx
import asyncio
import hashlib
import json
import logging
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Security, Header, BackgroundTasks
from fastapi.security.api_key import APIKeyHeader
from sqlalchemy import text, delete, select, func, update
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from types import SimpleNamespace
from app.database import get_db, engine, async_session_factory
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
from app.models import (
    ScheduleDraft,
    ScheduleSlot,
    Curriculum,
    Schedule,
    ImportedScheduleChange,
    Group,
    Subject,
    Teacher,
    ScheduleOverride,
    ScheduleVersion,
    Setting,
)
from app.models.entities import SchedulePublication, SchedulePublicationSnapshot
from app.services.settings import settings_service
from app.services.week import get_week_type
import uuid
import traceback
from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])
IMPORT_PAGE_RETRIES = 3

ANOMALY_GROUP_THRESHOLD_DEFAULT = 0.30
ANOMALY_TOTAL_THRESHOLD_DEFAULT = 0.20


async def get_import_settings(db: AsyncSession) -> dict:
    auto_pub_val = await settings_service.get(db, "import_auto_publish", default="true")
    auto_publish = auto_pub_val.strip().lower() == "true" if auto_pub_val else True
    group_thresh = float(
        await settings_service.get(
            db,
            "import_anomaly_group_threshold",
            default=str(ANOMALY_GROUP_THRESHOLD_DEFAULT),
        )
    )
    total_thresh = float(
        await settings_service.get(
            db,
            "import_anomaly_total_threshold",
            default=str(ANOMALY_TOTAL_THRESHOLD_DEFAULT),
        )
    )
    return {
        "auto_publish": auto_publish,
        "anomaly_group_threshold": group_thresh,
        "anomaly_total_threshold": total_thresh,
    }


def hash_payload(payload: dict) -> str:
    serialized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def import_payload_hash(payload: dict) -> str:
    comparable = {
        key: value
        for key, value in payload.items()
        if key not in {"created_curriculum_ids", "import_scope", "auto_publish_skipped_reason"}
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
        records = sorted(
            payload["changes"],
            key=lambda item: json.dumps(item, sort_keys=True, default=str),
        )
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
        or incoming.get("week_type", "both") != existing.week_type
    ):
        return False
    incoming_room = _normalize_room(incoming.get("room"))
    existing_room = _normalize_room(_schedule_room(existing))
    return incoming_room == existing_room


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


def annotate_substitutions_and_swaps(
    substitutions: list[dict],
    base_slots: list[dict],
    current_schedules: list[Schedule],
    semester_start: date | None,
) -> tuple[list[dict], list[dict]]:
    """
    1. Compares incoming lessons with current_schedules:
       - Identifies if a lesson is identical to base schedule (is_equal_to_base = True).
       - Identifies if lessons on the same day swapped slots (change_type = 'swap', is_swap = True, swap_with_lesson = m).
       - Identifies if a lesson was moved from another slot on the same day (change_type = 'move', is_move = True, moved_from_lesson = m).
       - Identifies regular substitutions (change_type = 'substitution').
    2. Discovers implicit swaps/changes from base_slots that do not match base schedule.
    3. Returns (annotated_substitutions, cleaned_base_slots).
    """
    def _matches_slot(inc: dict, base: Schedule | None) -> bool:
        if base is None:
            return False
        if inc.get("subject_id") != base.subject_id:
            return False
        if inc.get("teacher_id") != base.teacher_id:
            return False
        if inc.get("second_teacher_id") != base.second_teacher_id:
            return False
        inc_room = _normalize_room(inc.get("room"))
        base_room = _normalize_room(_schedule_room(base))
        if inc_room != base_room:
            return False
        return True

    schedules_by_group_dow: dict[tuple[int, int], list[Schedule]] = {}
    for sch in current_schedules:
        schedules_by_group_dow.setdefault((sch.group_id, sch.day_of_week), []).append(sch)

    items_by_group_date: dict[tuple[int, str], dict[int, dict]] = {}
    existing_sub_keys = set()

    for sub in substitutions:
        key = (sub["group_id"], sub["date"])
        sub.setdefault("is_explicit_substitution", True)
        items_by_group_date.setdefault(key, {})[sub["lesson_number"]] = sub
        existing_sub_keys.add((sub["group_id"], sub["date"], sub["lesson_number"]))

    implicit_substitutions = []
    clean_base_slots = []
    for slot in base_slots:
        d_str = slot.get("date")
        if not d_str:
            clean_base_slots.append(slot)
            continue

        gid = slot["group_id"]
        ln = slot["lesson_number"]
        if (gid, d_str, ln) in existing_sub_keys:
            continue

        try:
            d_obj = datetime.strptime(d_str, "%Y-%m-%d").date()
        except Exception:
            clean_base_slots.append(slot)
            continue

        dow = d_obj.isoweekday()
        w_type = get_week_type(d_obj, semester_start)
        day_schedules = schedules_by_group_dow.get((gid, dow), [])
        base_at_ln = next(
            (s for s in day_schedules if s.lesson_number == ln and _week_matches(w_type, s.week_type)),
            None
        )

        if _matches_slot(slot, base_at_ln):
            clean_base_slots.append(slot)
        else:
            implicit_item = {
                "date": d_str,
                "lesson_number": ln,
                "group_id": gid,
                "subject_id": slot["subject_id"],
                "teacher_id": slot.get("teacher_id"),
                "second_teacher_id": slot.get("second_teacher_id"),
                "room": slot.get("room"),
                "week_type": slot.get("week_type", "both"),
                "is_explicit_substitution": False,
            }
            items_by_group_date.setdefault((gid, d_str), {})[ln] = implicit_item
            implicit_substitutions.append(implicit_item)

    all_substitutions = [*substitutions, *implicit_substitutions]

    for (gid, d_str), lessons_map in items_by_group_date.items():
        try:
            d_obj = datetime.strptime(d_str, "%Y-%m-%d").date()
        except Exception:
            continue

        dow = d_obj.isoweekday()
        w_type = get_week_type(d_obj, semester_start)
        day_schedules = schedules_by_group_dow.get((gid, dow), [])
        base_slots_for_day = {
            s.lesson_number: s
            for s in day_schedules
            if _week_matches(w_type, s.week_type)
        }

        for ln, inc in lessons_map.items():
            base_at_ln = base_slots_for_day.get(ln)
            if _matches_slot(inc, base_at_ln):
                inc["is_equal_to_base"] = True
                inc["change_type"] = "none"
                inc["is_swap"] = False
                inc["swap_with_lesson"] = None
                inc["is_move"] = False
                inc["moved_from_lesson"] = None
                inc["note"] = "Відповідає базовому розкладу"
                continue

            inc["is_equal_to_base"] = False
            subj_id = inc.get("subject_id")
            teach_id = inc.get("teacher_id")
            candidates = [
                m for m, b in base_slots_for_day.items()
                if m != ln and b.subject_id == subj_id and (teach_id is None or b.teacher_id == teach_id)
            ]

            if candidates:
                m = candidates[0]
                base_at_m = base_slots_for_day.get(m)
                inc_at_m = lessons_map.get(m)

                if base_at_ln and inc_at_m and _matches_slot(inc_at_m, base_at_ln):
                    inc["change_type"] = "swap"
                    inc["is_swap"] = True
                    inc["swap_with_lesson"] = m
                    inc["is_move"] = False
                    inc["moved_from_lesson"] = None
                    inc["note"] = f"Перестановка пар: {ln} ↔ {m}"
                else:
                    inc["change_type"] = "move"
                    inc["is_swap"] = False
                    inc["swap_with_lesson"] = None
                    inc["is_move"] = True
                    inc["moved_from_lesson"] = m
                    inc["note"] = f"Перенесено з {m}-ї пари"
            else:
                inc["change_type"] = "substitution"
                inc["is_swap"] = False
                inc["swap_with_lesson"] = None
                inc["is_move"] = False
                inc["moved_from_lesson"] = None
                inc["note"] = "Заміна пари"

    return all_substitutions, clean_base_slots


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
    scope = payload.get("import_scope") or {}
    scope_groups = set(scope.get("group_ids", []))

    schedules = (await db.scalars(
        select(Schedule)
        .where(Schedule.is_active.is_(True))
        .options(joinedload(Schedule.teacher))
    )).all()
    if "base_version_id" in payload:
        version_id = payload["base_version_id"]
        schedules = [s for s in schedules if s.version_id == version_id]
    if scope_groups:
        schedules = [s for s in schedules if s.group_id in scope_groups]

    incoming_slots = payload.get("base_slots", [])
    if scope_groups and len(incoming_slots) != len(schedules):
        return False

    from collections import Counter

    def _inc_sig(s: dict) -> tuple:
        return (
            s["group_id"], s["subject_id"], s["teacher_id"], s.get("second_teacher_id"),
            s["day_of_week"], s["lesson_number"], s.get("week_type", "both"),
            _normalize_room(s.get("room")),
        )

    def _db_sig(s: Schedule) -> tuple:
        return (
            s.group_id, s.subject_id, s.teacher_id, s.second_teacher_id,
            s.day_of_week, s.lesson_number, s.week_type,
            _normalize_room(_schedule_room(s)),
        )

    incoming_counts = Counter(_inc_sig(s) for s in incoming_slots)
    existing_counts = Counter(_db_sig(s) for s in schedules)
    if scope_groups:
        if incoming_counts != existing_counts:
            return False
    else:
        for sig, cnt in incoming_counts.items():
            if existing_counts[sig] < cnt:
                return False

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
    return await execute_import_logic(db, weeks, actor_id=user.id)


@router.get("/import/status")
async def get_import_status_endpoint(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin", "editor")),
):
    import_settings = await get_import_settings(db)

    # Last publication info
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

    # Pending anomaly drafts (for sidebar badge and banner)
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

    # Active notification for admin banner
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


@router.get("/import/settings")
async def get_settings_endpoint(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin")),
):
    return await get_import_settings(db)


@router.put("/import/settings")
async def update_settings_endpoint(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin")),
):
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


@router.post("/import/notification/dismiss")
async def dismiss_notification_endpoint(
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("admin", "editor")),
):
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


async def _do_import(db: AsyncSession, weeks: int, error_id: str, actor_id: int | None = None):
    fetcher = ScheduleFetcher()
    parser = KREParser()
    set_active_jobs(1)
    try:
        group_ids = await fetcher.get_all_group_ids()
        if not group_ids:
            raise HTTPException(502, detail={"code": "empty_import_group_list", "msg": "Джерело не повернуло групи. Імпорт зупинено."})

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

        semaphore = asyncio.Semaphore(5)

        def _parse_html_sync(raw_html: str):
            p_hash = hashlib.sha256(raw_html.encode("utf-8")).hexdigest()
            parsed_obj = parser.parse(raw_html)
            from selectolax.parser import HTMLParser
            tree = HTMLParser(raw_html)
            next_week_node = tree.css_first("a[aria-label='Наступний тиждень']")
            next_href = next_week_node.attributes.get("href") if next_week_node else None
            return p_hash, parsed_obj, next_href

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
                        page_hash, parsed, href = await asyncio.to_thread(_parse_html_sync, html)
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

        scraped_weeks: dict[int, set[str]] = {}
        async with httpx.AsyncClient(timeout=20.0) as client:
            tasks = [fetch_and_parse(client, g_id) for g_id in group_ids]
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

        # Safety Guard 3: Manual edits protection (manually_edited == True or ScheduleOverride)
        skipped_manual = []
        clean_substitutions = []
        clean_cancelled = []

        all_target_dates = {
            datetime.strptime(item["date"], "%Y-%m-%d").date()
            for item in [*aggregated_substitutions, *aggregated_cancelled]
            if item.get("date")
        }
        all_target_groups = {
            item["group_id"]
            for item in [*aggregated_substitutions, *aggregated_cancelled]
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

        for sub in aggregated_substitutions:
            d_obj = datetime.strptime(sub["date"], "%Y-%m-%d").date()
            cell_key = (sub["group_id"], d_obj, sub["lesson_number"])
            if cell_key in manual_cells or cell_key in override_cells:
                skipped_manual.append({
                    "group_id": sub["group_id"],
                    "group_name": groups_map.get(sub["group_id"]).name if groups_map.get(sub["group_id"]) else None,
                    "date": sub["date"],
                    "lesson_number": sub["lesson_number"],
                    "kind": "substitution",
                })
            else:
                clean_substitutions.append(sub)

        for canc in aggregated_cancelled:
            d_obj = datetime.strptime(canc["date"], "%Y-%m-%d").date()
            cell_key = (canc["group_id"], d_obj, canc["lesson_number"])
            if cell_key in manual_cells or cell_key in override_cells:
                skipped_manual.append({
                    "group_id": canc["group_id"],
                    "group_name": groups_map.get(canc["group_id"]).name if groups_map.get(canc["group_id"]) else None,
                    "date": canc["date"],
                    "lesson_number": canc["lesson_number"],
                    "kind": "cancelled",
                })
            else:
                clean_cancelled.append(canc)

        # Rollback suppression: skip reverted changes until source page changes
        # Only consider reverted publications newer than the latest active (non-reverted) publication
        skipped_reverted = []
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

        unsuppressed_substitutions = []
        for sub in clean_substitutions:
            key = (sub["group_id"], sub["date"], sub["lesson_number"], "substitution")
            if key in suppressed_change_keys:
                skipped_reverted.append(sub)
            else:
                unsuppressed_substitutions.append(sub)

        unsuppressed_cancelled = []
        for canc in clean_cancelled:
            key = (canc["group_id"], canc["date"], canc["lesson_number"], "cancelled")
            if key in suppressed_change_keys:
                skipped_reverted.append(canc)
            else:
                unsuppressed_cancelled.append(canc)

        aggregated_substitutions = unsuppressed_substitutions
        aggregated_cancelled = unsuppressed_cancelled

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

        # Safety Guard 2: Anomaly limits (count only auto-publishable changes:
        # explicit substitutions and same-day lesson swaps/moves; auto-import never cancels lessons)
        from collections import Counter

        def _is_auto_publishable_sub(sub: dict) -> bool:
            if sub.get("is_equal_to_base"):
                return False
            return bool(
                sub.get("is_explicit_substitution", True)
                or sub.get("is_swap")
                or sub.get("is_move")
            )

        group_lessons_count = Counter()
        for sch in current_schedules:
            for d in scope_dates_obj:
                if d.isoweekday() == sch.day_of_week:
                    w_type = get_week_type(d, semester_start)
                    if _week_matches(w_type, sch.week_type):
                        group_lessons_count[sch.group_id] += 1

        total_scheduled_lessons = sum(group_lessons_count.values())

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
        # Auto-import has permission to publish ONLY explicit substitutions and same-day swaps/moves (no cancellations)
        auto_publish_substitutions = [
            s for s in aggregated_substitutions
            if _is_auto_publishable_sub(s)
        ]

        # Restore base slots under substitutions to prevent holes in draft schedule
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
                    "week_type": sub_week if same_cell else sch.week_type,
                }
                aggregated_base_slots.append(slot)
                restored_base_slots.append(slot)
                same_cell = [*same_cell, slot]

        aggregated_base_slots = normalize_base_slots(
            [{**slot, "room": _normalize_room(slot.get("room"))} for slot in aggregated_base_slots],
            prefer_incoming=True,
        )
        restored_base_slots = normalize_base_slots(
            [{**slot, "room": _normalize_room(slot.get("room"))} for slot in restored_base_slots],
            prefer_incoming=True,
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

        # Check existing pending draft and current matches
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

                # Retire older active substitution changes in scope (never touch manual edits or cancellations)
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

                # Insert explicit substitutions and swaps/moves only
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

                # Archive older pending import drafts
                old_pending = (await db.scalars(
                    select(ScheduleDraft).where(
                        ScheduleDraft.draft_type == "import",
                        ScheduleDraft.status == "pending",
                    )
                )).all()
                for d in old_pending:
                    d.status = "archived"

                # If there are cancellations, keep them in a review draft for admin confirmation
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

                # Create admin notification
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
        raise HTTPException(status_code=500, detail={"msg": "Внутрішня помилка імпорту. Зверніться до підтримки.", "error_id": error_id})
    finally:
        set_active_jobs(0)


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
    return await execute_import_logic(db, 2, actor_id=None)


async def schedule_auto_import_loop() -> None:
    """Фоновий цикл: періодично перевіряє сайт коледжу та автоматично імпортує заміни/розклад."""
    await asyncio.sleep(5)  # Перша перевірка через 5 секунд після старту сервера
    try:
        raw_interval = int(getattr(settings, "auto_import_interval_minutes", 30) or 30)
    except Exception:
        raw_interval = 30
    interval_seconds = max(300, raw_interval * 60)

    while True:
        try:
            async with async_session_factory() as db:
                logger.info("Auto-import: checking schedule and substitutions from college site...")
                result = await execute_import_logic(db=db, weeks=2, actor_id=None)
                meta = result.get("meta", {})
                if meta.get("unchanged"):
                    logger.info("Auto-import: schedule on college site is unchanged.")
                elif meta.get("auto_published"):
                    logger.info("Auto-import: changes auto-published successfully.")
                elif meta.get("is_anomaly"):
                    logger.warning("Auto-import: anomaly detected, left as draft for admin review.")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"Auto-import cycle error: {e}")
            try:
                async with async_session_factory() as err_db:
                    err_detail = getattr(e, "detail", str(e))
                    if isinstance(err_detail, dict):
                        err_msg = err_detail.get("message") or err_detail.get("msg") or str(err_detail)
                    else:
                        err_msg = str(err_detail)
                    await settings_service.set(
                        err_db,
                        "import_last_check_status",
                        json.dumps({
                            "checked_at": now_local().isoformat(),
                            "source": "Авто",
                            "status": "error",
                            "error_message": err_msg[:120],
                            "changes_count": 0,
                        }),
                    )
                    await err_db.commit()
            except Exception:
                pass

        await asyncio.sleep(interval_seconds)

