"""Validation, deduplication, swap/move annotation, and schedule matching helpers for schedule import."""

from collections import Counter
from datetime import date, datetime, timedelta
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.time import now_local
from app.models import ImportedScheduleChange, Schedule
from app.services.importer.hashing import (
    canonical_change_records as _canonical_change_records,
    import_changes_hash,
    normalize_room as _normalize_room,
)
from app.services.settings import settings_service
from app.services.week import get_week_type

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


def _is_valid_pos_int(val: Any) -> bool:
    return isinstance(val, int) and not isinstance(val, bool) and val > 0


def _is_valid_lesson_number(val: Any) -> bool:
    return isinstance(val, int) and not isinstance(val, bool) and 1 <= val <= 4


def _is_valid_iso_weekday_date(val: Any) -> bool:
    if not isinstance(val, str):
        return False
    try:
        d = date.fromisoformat(val)
        return d.isoweekday() in range(1, 6)
    except ValueError:
        return False


def validate_and_sanitize_import_items(
    substitutions: list[dict],
    cancelled: list[dict],
    base_slots: list[dict],
) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Validates and sanitizes imported schedule items before diffing/persistence:
    - Filters out malformed records (invalid dates, weekends, lesson_number outside 1..4, non-positive IDs)
    - Truncates room strings to 100 chars and normalizes whitespace
    - Normalizes week_type to ('numerator', 'denominator', 'both')
    - Clears duplicate second_teacher_id when identical to teacher_id
    """
    valid_weeks = {"numerator", "denominator", "both"}
    clean_subs: list[dict] = []
    for item in substitutions:
        if not isinstance(item, dict):
            continue
        if not _is_valid_iso_weekday_date(item.get("date")):
            continue
        if not _is_valid_lesson_number(item.get("lesson_number")):
            continue
        if not _is_valid_pos_int(item.get("group_id")) or not _is_valid_pos_int(item.get("subject_id")):
            continue
        t1 = item.get("teacher_id")
        t2 = item.get("second_teacher_id")
        if t1 is not None and not _is_valid_pos_int(t1):
            t1 = None
        if t2 is not None and (not _is_valid_pos_int(t2) or t2 == t1):
            t2 = None
        room_raw = item.get("room")
        room_clean = _normalize_room(room_raw)[:100] if isinstance(room_raw, str) else ""
        w_type = item.get("week_type", "both")
        if w_type not in valid_weeks:
            w_type = "both"
        clean_subs.append({
            **item,
            "teacher_id": t1,
            "second_teacher_id": t2,
            "room": room_clean or None,
            "week_type": w_type,
        })

    clean_canc: list[dict] = []
    for item in cancelled:
        if not isinstance(item, dict):
            continue
        if not _is_valid_iso_weekday_date(item.get("date")):
            continue
        if not _is_valid_lesson_number(item.get("lesson_number")):
            continue
        if not _is_valid_pos_int(item.get("group_id")):
            continue
        w_type = item.get("week_type", "both")
        if w_type not in valid_weeks:
            w_type = "both"
        clean_canc.append({
            **item,
            "week_type": w_type,
        })

    clean_base: list[dict] = []
    for slot in base_slots:
        if not isinstance(slot, dict):
            continue
        if not _is_valid_pos_int(slot.get("group_id")) or not _is_valid_pos_int(slot.get("subject_id")):
            continue
        if not _is_valid_lesson_number(slot.get("lesson_number")):
            continue
        dow = slot.get("day_of_week")
        d_str = slot.get("date")
        if d_str is not None:
            if not _is_valid_iso_weekday_date(d_str):
                continue
            dow = date.fromisoformat(d_str).isoweekday()
        if not (isinstance(dow, int) and not isinstance(dow, bool) and 1 <= dow <= 5):
            continue
        t1 = slot.get("teacher_id")
        t2 = slot.get("second_teacher_id")
        if t1 is not None and not _is_valid_pos_int(t1):
            t1 = None
        if t2 is not None and (not _is_valid_pos_int(t2) or t2 == t1):
            t2 = None
        room_raw = slot.get("room")
        room_clean = _normalize_room(room_raw)[:100] if isinstance(room_raw, str) else ""
        w_type = slot.get("week_type", "both")
        if w_type not in valid_weeks:
            w_type = "both"
        clean_base.append({
            **slot,
            "day_of_week": dow,
            "teacher_id": t1,
            "second_teacher_id": t2,
            "room": room_clean or None,
            "week_type": w_type,
        })

    return clean_subs, clean_canc, clean_base


def _deduplicate_import_changes(
    substitutions: list[dict],
    cancelled: list[dict],
) -> tuple[list[dict], list[dict]]:
    substitutions, cancelled, _ = validate_and_sanitize_import_items(substitutions, cancelled, [])
    substitution_by_cell: dict[tuple[str, int, int], dict] = {}
    for item in substitutions:
        key = (item["date"], item["group_id"], item["lesson_number"])
        current = substitution_by_cell.get(key)
        candidate = {
            **item,
            "room": _normalize_room(item.get("room"))[:100],
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
