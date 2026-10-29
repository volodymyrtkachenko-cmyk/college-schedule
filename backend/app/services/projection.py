from datetime import date, timedelta
from typing import Any, Optional, List, Dict, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import joinedload, aliased
from collections import defaultdict

from app.models import (
    Schedule, 
    ScheduleOverride, 
    ImportedScheduleChange, 
    SchedulePeriod, 
    SchedulePeriodSlot,
    ScheduleVersion,
    Group,
    AcademicEvent,
)
from app.services.settings import settings_service
from app.services.week import get_week_type
import copy
import re
import time as _time

_WEEK_PROJ_CACHE: dict[tuple, tuple[float, str, Dict[int, List["EffectiveLesson"]]]] = {}
_WEEK_PROJ_TTL = 45.0
_WEEK_PROJ_MAX = 256

_DAY_PROJ_CACHE: dict[tuple, tuple[float, List["EffectiveLesson"]]] = {}
_DAY_PROJ_TTL = 30.0
_DAY_PROJ_MAX = 256


def invalidate_projection_cache(group_id: Optional[int] = None) -> None:
    if group_id is None:
        _WEEK_PROJ_CACHE.clear()
        _DAY_PROJ_CACHE.clear()
        return
    stale_week = [k for k in _WEEK_PROJ_CACHE if k[1] == group_id or k[1] is None]
    for k in stale_week:
        _WEEK_PROJ_CACHE.pop(k, None)
    stale_day = [k for k in _DAY_PROJ_CACHE if k[1] == group_id or k[1] is None]
    for k in stale_day:
        _DAY_PROJ_CACHE.pop(k, None)


class EffectiveLesson:
    def __init__(
        self,
        group_id: int,
        date: date,
        lesson_number: int,
        subject_id: Optional[int],
        teacher_id: Optional[int],
        second_teacher_id: Optional[int],
        room: Optional[str],
        stream_id: Optional[str],
        source_kind: str,
        source_ref_id: Optional[int],
        is_cancelled: bool = False,
        group_name: Optional[str] = None,
        subject_name: Optional[str] = None,
        teacher_name: Optional[str] = None,
        is_replacement: bool = False,
        event_type: Optional[str] = None,
        event_title: Optional[str] = None,
        custom_subject: Optional[str] = None,
        event_id: Optional[int] = None,
        time: Optional[str] = None,
        moved_to_date: Optional[date] = None,
        moved_to_lesson: Optional[int] = None,
        has_template: bool = False,
        teacher_room: Optional[str] = None,
        second_teacher_room: Optional[str] = None,
    ):
        self.group_id = group_id
        self.date = date
        self.lesson_number = lesson_number
        self.subject_id = subject_id
        self.teacher_id = teacher_id
        self.second_teacher_id = second_teacher_id
        self.room = room
        self.stream_id = stream_id
        self.source_kind = source_kind
        self.source_ref_id = source_ref_id
        self.is_cancelled = is_cancelled
        self.group_name = group_name
        self.subject_name = subject_name
        self.teacher_name = teacher_name
        self.is_replacement = is_replacement
        self.event_type = event_type
        self.event_title = event_title
        self.custom_subject = custom_subject
        self.event_id = event_id
        self.time = time
        self.moved_to_date = moved_to_date
        self.moved_to_lesson = moved_to_lesson
        self.has_template = has_template
        self.teacher_room = teacher_room
        self.second_teacher_room = second_teacher_room

        self.note_id: Optional[int] = None
        self.note_revision: int = 0
        self.note_text: Optional[str] = None

    @property
    def id(self) -> int:
        if self.source_kind == "base" and self.source_ref_id:
            return self.source_ref_id
        return -(self.source_ref_id or self.lesson_number)

    @property
    def occurrence_key(self) -> str:
        return f"group_{self.group_id}_{self.date.isoformat()}_slot_{self.lesson_number}"

def clean_room_string(value: Optional[str]) -> Optional[str]:
    if not value or not value.strip():
        return None
    val = value.strip()
    clean = re.sub(r'^(?:аудиторія|ауд\.?\s*иторія|ауд\.?)\s*', '', val, flags=re.IGNORECASE).strip()
    return clean or val


def _week_matches(cur: str, base: str) -> bool:
    return cur == "both" or base == "both" or cur == base


def is_same_day_swap(
    item_group_id: int,
    item_subject_id: Optional[int],
    item_teacher_id: Optional[int],
    base_lessons_for_day: list,
) -> bool:
    """
    Checks if a lesson's subject and teacher already belong to the base schedule
    of the group on that same day. If so, moving or swapping it across lesson numbers
    is a rearrangement (перестановка), NOT a substitution (заміна).
    """
    if not item_subject_id:
        return False
    for b in base_lessons_for_day:
        if getattr(b, "group_id", None) == item_group_id and getattr(b, "subject_id", None) == item_subject_id:
            b_teacher = getattr(b, "teacher_id", None)
            if item_teacher_id is None or b_teacher is None or b_teacher == item_teacher_id:
                return True
    return False


def resolve_effective_room(
    room_override: Optional[str],
    teacher: Optional[Any] = None,
    second_teacher: Optional[Any] = None,
) -> Optional[str]:
    if room_override and room_override.strip():
        return clean_room_string(room_override)
    rooms = []
    if teacher and getattr(teacher, "room", None) and teacher.room.strip():
        cleaned = clean_room_string(teacher.room)
        if cleaned:
            rooms.append(cleaned)
    if second_teacher and getattr(second_teacher, "room", None) and second_teacher.room.strip():
        cleaned = clean_room_string(second_teacher.room)
        if cleaned:
            rooms.append(cleaned)
    return " / ".join(rooms) if rooms else None

def resolve_own_room(teacher: Optional[Any] = None) -> Optional[str]:
    room = getattr(teacher, "room", None) if teacher else None
    if not room or not room.strip():
        return None
    return room.strip()

def resolve_teacher_names(
    teacher: Optional[Any] = None,
    second_teacher: Optional[Any] = None,
) -> Optional[str]:
    names = []
    if teacher and getattr(teacher, "name", None):
        names.append(teacher.name.strip())
    if second_teacher and getattr(second_teacher, "name", None):
        names.append(second_teacher.name.strip())
    return " / ".join(names) if names else None

def infer_lesson_number(start_time: str) -> int:
    try:
        h, m = map(int, start_time.split(":")[:2])
        mins = h * 60 + m
        if mins < 10 * 60 + 30:
            return 1
        elif mins < 12 * 60 + 15:
            return 2
        elif mins < 13 * 60 + 55:
            return 3
        elif mins < 15 * 60 + 25:
            return 4
        else:
            return 5
    except Exception:
        return 1

async def build_projection(
    db: AsyncSession, 
    target_date: date, 
    group_id: Optional[int] = None, 
    teacher_id: Optional[int] = None,
    include_cancelled: bool = False,
) -> List[EffectiveLesson]:
    can_use_cache = not db.new and not db.dirty and not db.deleted
    cache_key = (target_date, group_id, teacher_id, include_cancelled)
    now_mono = _time.monotonic()
    if can_use_cache:
        cached_day = _DAY_PROJ_CACHE.get(cache_key)
        if cached_day is not None and (now_mono - cached_day[0]) < _DAY_PROJ_TTL:
            return list(cached_day[1])

    # 1. Fetch active version and week type
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(target_date, semester_start)
    weekday = target_date.isoweekday()

    active_version = await db.scalar(
        select(ScheduleVersion).where(
            ScheduleVersion.valid_from <= target_date,
            ScheduleVersion.valid_until >= target_date,
            ScheduleVersion.is_active.is_(True)
        ).order_by(ScheduleVersion.valid_from.desc()).limit(1)
    )

    # 2. Fetch periods (holidays, sessions, practice)
    periods_query = select(SchedulePeriod).where(
        SchedulePeriod.start_date <= target_date,
        SchedulePeriod.end_date >= target_date
    ).options(
        joinedload(SchedulePeriod.groups),
        joinedload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.group),
        joinedload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.subject),
        joinedload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.teacher),
        joinedload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.second_teacher)
    )
    periods = (await db.scalars(periods_query)).unique().all()

    blocked_groups = set()
    practice_groups = set()
    for p in periods:
        for g in p.groups:
            if p.period_type in ("holiday", "session", "diploma", "attestation"):
                blocked_groups.add(g.id)
            elif p.period_type == "practice":
                practice_groups.add(g.id)
    if any(not p.groups for p in periods if p.period_type == "holiday"):
        # Global holiday
        return []

    is_all_groups_blocked = any(
        not p.groups for p in periods if p.period_type in ("session", "diploma", "attestation")
    )

    # 3. Base Schedule
    base_conds = [
        Schedule.day_of_week == weekday,
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", week_type)),
        or_(Schedule.effective_from.is_(None), Schedule.effective_from <= target_date),
        or_(Schedule.effective_until.is_(None), Schedule.effective_until >= target_date),
    ]
    if active_version:
        base_conds.append(Schedule.version_id == active_version.id)
    else:
        base_conds.append(Schedule.version_id.is_(None))
    if group_id is not None:
        base_conds.append(Schedule.group_id == group_id)
    elif teacher_id is not None:
        base_conds.append(or_(Schedule.teacher_id == teacher_id, Schedule.second_teacher_id == teacher_id))

    base_query = select(Schedule).where(*base_conds).options(
        joinedload(Schedule.group), joinedload(Schedule.subject),
        joinedload(Schedule.teacher), joinedload(Schedule.second_teacher)
    )
    base_lessons = (await db.scalars(base_query)).all()

    # 4. Imported Changes (ordered by version DESC so the first per cell is latest)
    import_conds = [
        ImportedScheduleChange.date == target_date,
        ImportedScheduleChange.is_published.is_(True),
    ]
    if group_id is not None:
        import_conds.append(ImportedScheduleChange.group_id == group_id)
    elif teacher_id is not None:
        teacher_groups = {b.group_id for b in base_lessons}
        t_filters = [
            ImportedScheduleChange.teacher_id == teacher_id,
            ImportedScheduleChange.second_teacher_id == teacher_id,
        ]
        if teacher_groups:
            t_filters.append(ImportedScheduleChange.group_id.in_(teacher_groups))
        import_conds.append(or_(*t_filters))

    import_query = (
        select(ImportedScheduleChange)
        .where(*import_conds)
        .options(
            joinedload(ImportedScheduleChange.group),
            joinedload(ImportedScheduleChange.subject),
            joinedload(ImportedScheduleChange.teacher),
            joinedload(ImportedScheduleChange.second_teacher),
        )
        .order_by(ImportedScheduleChange.version.desc())
    )
    raw_imported_changes = (await db.scalars(import_query)).all()
    seen_imp_cells = set()
    imported_changes = []
    for imp in raw_imported_changes:
        cell_key = (imp.date, imp.group_id, imp.lesson_number)
        if cell_key not in seen_imp_cells:
            seen_imp_cells.add(cell_key)
            imported_changes.append(imp)

    # 5. Manual Overrides
    override_conds = [ScheduleOverride.date == target_date]
    if group_id is not None:
        override_conds.append(ScheduleOverride.group_id == group_id)
    elif teacher_id is not None:
        teacher_groups = {b.group_id for b in base_lessons}
        t_filters = [
            ScheduleOverride.teacher_id == teacher_id,
            ScheduleOverride.second_teacher_id == teacher_id,
        ]
        if teacher_groups:
            t_filters.append(ScheduleOverride.group_id.in_(teacher_groups))
        override_conds.append(or_(*t_filters))

    override_query = select(ScheduleOverride).where(*override_conds).options(
        joinedload(ScheduleOverride.group),
        joinedload(ScheduleOverride.subject), joinedload(ScheduleOverride.teacher),
        joinedload(ScheduleOverride.second_teacher)
    )
    overrides = (await db.scalars(override_query)).all()

    # Compute effective cells
    # Several base lessons may legitimately share one group/slot (subgroups, streams),
    # so cells are keyed by a unique source id and grouped by slot for overrides.
    cells: Dict[Tuple[int, int, str], EffectiveLesson] = {}
    slot_map: Dict[Tuple[int, int], List[str]] = defaultdict(list)

    def put_cell(g, n, uid, lesson):
        cells[(g, n, uid)] = lesson
        slot_map[(g, n)].append(uid)

    def slot_keys(g, n):
        return [(g, n, u) for u in slot_map.get((g, n), [])]

    def replace_slot(g, n, lesson, uid):
        uids = slot_map.pop((g, n), [])
        had_template = any(getattr(cells.get((g, n, u)), "has_template", False) for u in uids)
        for u in uids:
            cells.pop((g, n, u), None)
        lesson.has_template = had_template
        put_cell(g, n, uid, lesson)

    # A0. Add practice slots
    for p in periods:
        if p.period_type == "practice":
            for slot in p.slots:
                if slot.day_of_week == weekday and (group_id is None or slot.group_id == group_id):
                    slot_room = resolve_effective_room(slot.room_override, slot.teacher, slot.second_teacher)
                    slot_teacher_name = resolve_teacher_names(slot.teacher, slot.second_teacher)
                    put_cell(slot.group_id, slot.lesson_number, f"p{slot.id}", EffectiveLesson(
                        group_id=slot.group_id, date=target_date, lesson_number=slot.lesson_number,
                        subject_id=slot.subject_id, teacher_id=slot.teacher_id, second_teacher_id=slot.second_teacher_id,
                        room=slot_room, stream_id=None,
                        teacher_room=resolve_own_room(slot.teacher), second_teacher_room=resolve_own_room(slot.second_teacher),
                        source_kind="practice", source_ref_id=slot.id,
                        group_name=slot.group.name if getattr(slot, "group", None) else None, 
                        subject_name=slot.subject.name if slot.subject else None, 
                        teacher_name=slot_teacher_name,
                        is_replacement=True
                    ))

    # A. Fill with base
    for b in base_lessons:
        if is_all_groups_blocked or b.group_id in blocked_groups:
            continue
        # practice groups normally don't have regular lessons, but if they do, we can skip or mark cancelled
        is_practice = b.group_id in practice_groups
        if is_practice: continue # T10 priority: practice overrides base

        b_room = resolve_effective_room(b.room_override, b.teacher, b.second_teacher)
        b_teacher_name = resolve_teacher_names(b.teacher, b.second_teacher)
        put_cell(b.group_id, b.lesson_number, f"b{b.id}", EffectiveLesson(
            group_id=b.group_id, date=target_date, lesson_number=b.lesson_number,
            subject_id=b.subject_id, teacher_id=b.teacher_id, second_teacher_id=b.second_teacher_id,
            room=b_room, stream_id=b.stream_id,
            teacher_room=resolve_own_room(b.teacher), second_teacher_room=resolve_own_room(b.second_teacher),
            source_kind="base", source_ref_id=b.id,
            group_name=b.group.name if b.group else None,
            subject_name=b.subject.name if b.subject else None,
            teacher_name=b_teacher_name,
            is_replacement=b.is_replacement,
            has_template=True,
        ))

    # B. Apply Imported Changes
    for imp in imported_changes:
        key = (imp.group_id, imp.lesson_number)
        if imp.group_id in blocked_groups:
            continue
        if imp.kind == "cancelled":
            for k in slot_keys(*key):
                cells[k].is_cancelled = True
                cells[k].source_kind = "import"
                cells[k].source_ref_id = imp.id
        elif imp.kind == "substitution":
            imp_room_override = getattr(imp, 'room_override', getattr(imp, 'room', None))
            imp_room = resolve_effective_room(imp_room_override, imp.teacher, imp.second_teacher)
            imp_teacher_name = resolve_teacher_names(imp.teacher, imp.second_teacher)
            is_swap_or_move = (
                getattr(imp, "change_type", None) in ("swap", "move")
                or is_same_day_swap(imp.group_id, imp.subject_id, imp.teacher_id, base_lessons)
            )
            replace_slot(*key, EffectiveLesson(
                group_id=imp.group_id, date=target_date, lesson_number=imp.lesson_number,
                subject_id=imp.subject_id, teacher_id=imp.teacher_id, second_teacher_id=imp.second_teacher_id,
                room=imp_room, stream_id=None,
                teacher_room=resolve_own_room(imp.teacher), second_teacher_room=resolve_own_room(imp.second_teacher),
                source_kind="import", source_ref_id=imp.id,
                group_name=imp.group.name if imp.group else None,
                subject_name=imp.subject.name if imp.subject else None,
                teacher_name=imp_teacher_name,
                is_replacement=not is_swap_or_move
            ), f"i{imp.id}")

    # C. Apply Manual Overrides
    for ovr in overrides:
        key = (ovr.group_id, ovr.lesson_number)
        if ovr.group_id in blocked_groups:
            continue
        if ovr.cancelled:
            found = False
            for k in slot_keys(*key):
                cells[k].is_cancelled = True
                cells[k].source_kind = "manual"
                cells[k].source_ref_id = ovr.id
                cells[k].moved_to_date = getattr(ovr, "moved_to_date", None)
                cells[k].moved_to_lesson = getattr(ovr, "moved_to_lesson", None)
                found = True
            if not found:
                ovr_room = resolve_effective_room(ovr.room, ovr.teacher, ovr.second_teacher)
                ovr_teacher_name = resolve_teacher_names(ovr.teacher, ovr.second_teacher)
                put_cell(ovr.group_id, ovr.lesson_number, f"o{ovr.id}", EffectiveLesson(
                    group_id=ovr.group_id, date=target_date, lesson_number=ovr.lesson_number,
                    subject_id=ovr.subject_id, teacher_id=ovr.teacher_id, second_teacher_id=ovr.second_teacher_id,
                    room=ovr_room, stream_id=ovr.stream_id,
                    teacher_room=resolve_own_room(ovr.teacher), second_teacher_room=resolve_own_room(ovr.second_teacher),
                    source_kind="manual", source_ref_id=ovr.id,
                    is_cancelled=True,
                    group_name=ovr.group.name if getattr(ovr, "group", None) else None,
                    subject_name=ovr.subject.name if ovr.subject else "Скасована пара",
                    teacher_name=ovr_teacher_name,
                    is_replacement=True,
                    moved_to_date=getattr(ovr, "moved_to_date", None),
                    moved_to_lesson=getattr(ovr, "moved_to_lesson", None),
                ))
        else:
            # Add or replace
            ovr_room = resolve_effective_room(ovr.room, ovr.teacher, ovr.second_teacher)
            ovr_teacher_name = resolve_teacher_names(ovr.teacher, ovr.second_teacher)
            is_swap_or_move = is_same_day_swap(ovr.group_id, ovr.subject_id, ovr.teacher_id, base_lessons)
            replace_slot(*key, EffectiveLesson(
                group_id=ovr.group_id, date=target_date, lesson_number=ovr.lesson_number,
                subject_id=ovr.subject_id, teacher_id=ovr.teacher_id, second_teacher_id=ovr.second_teacher_id,
                room=ovr_room, stream_id=ovr.stream_id,
                teacher_room=resolve_own_room(ovr.teacher), second_teacher_room=resolve_own_room(ovr.second_teacher),
                source_kind="manual", source_ref_id=ovr.id,
                group_name=ovr.group.name if getattr(ovr, "group", None) else None,
                subject_name=ovr.subject.name if ovr.subject else None,
                teacher_name=ovr_teacher_name,
                is_replacement=not is_swap_or_move
            ), f"o{ovr.id}")

    # D. Apply Academic Events (Exams, Consultations, Credits, Defenses, Special Events)
    events_stmt = (
        select(AcademicEvent)
        .where(AcademicEvent.event_date == target_date)
        .options(
            joinedload(AcademicEvent.group),
            joinedload(AcademicEvent.subject),
            joinedload(AcademicEvent.teacher),
        )
    )
    if group_id is not None:
        events_stmt = events_stmt.where(AcademicEvent.group_id == group_id)
    if teacher_id is not None:
        events_stmt = events_stmt.where(AcademicEvent.teacher_id == teacher_id)

    day_events = (await db.scalars(events_stmt)).all()
    for ev in day_events:
        l_num = ev.lesson_number or infer_lesson_number(ev.start_time)
        resolved_subject = (
            (ev.custom_subject or "").strip()
            or (ev.subject.name if ev.subject else None)
            or (ev.title or "").strip()
            or "Подія"
        )
        time_str = f"{ev.start_time}-{ev.end_time}" if ev.end_time else ev.start_time
        ev_lesson = EffectiveLesson(
            group_id=ev.group_id,
            date=target_date,
            lesson_number=l_num,
            subject_id=ev.subject_id,
            teacher_id=ev.teacher_id,
            second_teacher_id=None,
            room=ev.room or (ev.teacher.room if ev.teacher and ev.teacher.room else None),
            stream_id=None,
            source_kind="event",
            source_ref_id=ev.id,
            group_name=ev.group.name if ev.group else None,
            subject_name=resolved_subject,
            teacher_name=ev.teacher.name if ev.teacher else None,
            is_replacement=True,
            event_type=ev.event_type,
            event_title=ev.title,
            custom_subject=ev.custom_subject,
            event_id=ev.id,
            time=time_str,
        )
        if ev.note:
            ev_lesson.note_text = ev.note
        replace_slot(ev.group_id, l_num, ev_lesson, f"e{ev.id}")

    # Filter results
    results = [c for c in cells.values() if include_cancelled or not c.is_cancelled]

    if group_id:
        results = [c for c in results if c.group_id == group_id]
    if teacher_id:
        results = [c for c in results if c.teacher_id == teacher_id or c.second_teacher_id == teacher_id]

    # Optional: bind notes (T06)
    # We can do this in a separate pass or here.
    from app.models.lesson_notes import LessonOccurrenceNote
    # ... logic to attach notes ...

    sorted_results = sorted(results, key=lambda x: x.lesson_number)
    if can_use_cache:
        if len(_DAY_PROJ_CACHE) >= _DAY_PROJ_MAX:
            oldest_day_key = min(_DAY_PROJ_CACHE, key=lambda k: _DAY_PROJ_CACHE[k][0])
            _DAY_PROJ_CACHE.pop(oldest_day_key, None)
        _DAY_PROJ_CACHE[cache_key] = (now_mono, list(sorted_results))
    return sorted_results


async def build_week_projection(
    db: AsyncSession,
    start_date: date,
    group_id: Optional[int] = None,
    teacher_id: Optional[int] = None,
    include_cancelled: bool = False,
) -> Tuple[str, Dict[int, List[EffectiveLesson]]]:
    cache_key = (start_date, group_id, teacher_id, include_cancelled)
    now_mono = _time.monotonic()
    cached = _WEEK_PROJ_CACHE.get(cache_key)
    if cached is not None and (now_mono - cached[0]) < _WEEK_PROJ_TTL:
        return cached[1], {k: list(v) for k, v in cached[2].items()}

    """Batch-load 5 weekdays (Mon..Fri) in 5 queries instead of 25."""
    end_date = start_date + timedelta(days=4)
    semester_start = await settings_service.get_semester_start(db)
    week_type = get_week_type(start_date, semester_start)

    versions = (
        await db.scalars(
            select(ScheduleVersion)
            .where(
                ScheduleVersion.valid_from <= end_date,
                ScheduleVersion.valid_until >= start_date,
                ScheduleVersion.is_active.is_(True),
            )
            .order_by(ScheduleVersion.valid_from.desc())
        )
    ).all()

    periods = (
        await db.scalars(
            select(SchedulePeriod)
            .where(
                SchedulePeriod.start_date <= end_date,
                SchedulePeriod.end_date >= start_date,
            )
            .options(
                joinedload(SchedulePeriod.groups),
                joinedload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.group),
                joinedload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.subject),
                joinedload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.teacher),
                joinedload(SchedulePeriod.slots).joinedload(SchedulePeriodSlot.second_teacher),
            )
        )
    ).unique().all()

    base_conds = [
        Schedule.day_of_week.between(1, 5),
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", week_type)),
    ]
    version_ids = [v.id for v in versions]
    weekdays_dates = [start_date + timedelta(days=w - 1) for w in range(1, 6)]
    needs_unversioned = any(
        not any(v.valid_from <= d <= v.valid_until for v in versions)
        for d in weekdays_dates
    )
    if version_ids and not needs_unversioned:
        base_conds.append(Schedule.version_id.in_(version_ids))
    elif version_ids and needs_unversioned:
        base_conds.append(or_(Schedule.version_id.in_(version_ids), Schedule.version_id.is_(None)))
    else:
        base_conds.append(Schedule.version_id.is_(None))
    base_conds.append(or_(Schedule.effective_from.is_(None), Schedule.effective_from <= end_date))
    base_conds.append(or_(Schedule.effective_until.is_(None), Schedule.effective_until >= start_date))
    if group_id is not None:
        base_conds.append(Schedule.group_id == group_id)
    elif teacher_id is not None:
        base_conds.append(or_(Schedule.teacher_id == teacher_id, Schedule.second_teacher_id == teacher_id))

    all_base_lessons = (
        await db.scalars(
            select(Schedule)
            .where(*base_conds)
            .options(
                joinedload(Schedule.group),
                joinedload(Schedule.subject),
                joinedload(Schedule.teacher),
                joinedload(Schedule.second_teacher),
            )
        )
    ).all()

    import_conds = [
        ImportedScheduleChange.date.between(start_date, end_date),
        ImportedScheduleChange.is_published.is_(True),
    ]
    if group_id is not None:
        import_conds.append(ImportedScheduleChange.group_id == group_id)
    elif teacher_id is not None:
        teacher_groups = {b.group_id for b in all_base_lessons}
        t_filters = [
            ImportedScheduleChange.teacher_id == teacher_id,
            ImportedScheduleChange.second_teacher_id == teacher_id,
        ]
        if teacher_groups:
            t_filters.append(ImportedScheduleChange.group_id.in_(teacher_groups))
        import_conds.append(or_(*t_filters))

    raw_all_imported = (
        await db.scalars(
            select(ImportedScheduleChange)
            .where(*import_conds)
            .options(
                joinedload(ImportedScheduleChange.group),
                joinedload(ImportedScheduleChange.subject),
                joinedload(ImportedScheduleChange.teacher),
                joinedload(ImportedScheduleChange.second_teacher),
            )
            .order_by(ImportedScheduleChange.version.desc())
        )
    ).all()
    seen_week_imp_cells = set()
    all_imported = []
    for imp in raw_all_imported:
        cell_key = (imp.date, imp.group_id, imp.lesson_number)
        if cell_key not in seen_week_imp_cells:
            seen_week_imp_cells.add(cell_key)
            all_imported.append(imp)

    override_conds = [ScheduleOverride.date.between(start_date, end_date)]
    if group_id is not None:
        override_conds.append(ScheduleOverride.group_id == group_id)
    elif teacher_id is not None:
        teacher_groups = {b.group_id for b in all_base_lessons}
        t_filters = [
            ScheduleOverride.teacher_id == teacher_id,
            ScheduleOverride.second_teacher_id == teacher_id,
        ]
        if teacher_groups:
            t_filters.append(ScheduleOverride.group_id.in_(teacher_groups))
        override_conds.append(or_(*t_filters))

    all_overrides = (
        await db.scalars(
            select(ScheduleOverride)
            .where(*override_conds)
            .options(
                joinedload(ScheduleOverride.group),
                joinedload(ScheduleOverride.subject),
                joinedload(ScheduleOverride.teacher),
                joinedload(ScheduleOverride.second_teacher),
            )
        )
    ).all()

    events_stmt = (
        select(AcademicEvent)
        .where(AcademicEvent.event_date.between(start_date, end_date))
        .options(
            joinedload(AcademicEvent.group),
            joinedload(AcademicEvent.subject),
            joinedload(AcademicEvent.teacher),
        )
    )
    if group_id is not None:
        events_stmt = events_stmt.where(AcademicEvent.group_id == group_id)
    if teacher_id is not None:
        events_stmt = events_stmt.where(AcademicEvent.teacher_id == teacher_id)

    all_events = (await db.scalars(events_stmt)).all()

    lessons_by_day: Dict[int, List[EffectiveLesson]] = {}

    for weekday in range(1, 6):
        target_date = start_date + timedelta(days=weekday - 1)
        active_version = next(
            (v for v in versions if v.valid_from <= target_date <= v.valid_until),
            None,
        )
        day_periods = [p for p in periods if p.start_date <= target_date <= p.end_date]

        if any(not p.groups for p in day_periods if p.period_type == "holiday"):
            lessons_by_day[weekday] = []
            continue

        is_all_groups_blocked = any(
            not p.groups for p in day_periods if p.period_type in ("session", "diploma", "attestation")
        )

        blocked_groups = set()
        practice_groups = set()
        for p in day_periods:
            for g in p.groups:
                if p.period_type in ("holiday", "session", "diploma", "attestation"):
                    blocked_groups.add(g.id)
                elif p.period_type == "practice":
                    practice_groups.add(g.id)

        cells: Dict[Tuple[int, int, str], EffectiveLesson] = {}
        slot_map: Dict[Tuple[int, int], List[str]] = defaultdict(list)

        def put_cell(g, n, uid, lesson):
            cells[(g, n, uid)] = lesson
            slot_map[(g, n)].append(uid)

        def slot_keys(g, n):
            return [(g, n, u) for u in slot_map.get((g, n), [])]

        def replace_slot(g, n, lesson, uid):
            uids = slot_map.pop((g, n), [])
            had_template = any(getattr(cells.get((g, n, u)), "has_template", False) for u in uids)
            for u in uids:
                cells.pop((g, n, u), None)
            lesson.has_template = had_template
            put_cell(g, n, uid, lesson)

        for p in day_periods:
            if p.period_type == "practice":
                for slot in p.slots:
                    if slot.day_of_week == weekday and (group_id is None or slot.group_id == group_id):
                        slot_room = resolve_effective_room(slot.room_override, slot.teacher, slot.second_teacher)
                        slot_teacher_name = resolve_teacher_names(slot.teacher, slot.second_teacher)
                        put_cell(
                            slot.group_id,
                            slot.lesson_number,
                            f"p{slot.id}",
                            EffectiveLesson(
                                group_id=slot.group_id,
                                date=target_date,
                                lesson_number=slot.lesson_number,
                                subject_id=slot.subject_id,
                                teacher_id=slot.teacher_id,
                                second_teacher_id=slot.second_teacher_id,
                                teacher_room=resolve_own_room(slot.teacher), second_teacher_room=resolve_own_room(slot.second_teacher),
                                room=slot_room,
                                stream_id=None,
                                source_kind="practice",
                                source_ref_id=slot.id,
                                group_name=slot.group.name if getattr(slot, "group", None) else None,
                                subject_name=slot.subject.name if slot.subject else None,
                                teacher_name=slot_teacher_name,
                                is_replacement=True,
                            ),
                        )

        expected_version_id = active_version.id if active_version else None
        for b in all_base_lessons:
            if b.day_of_week != weekday or b.version_id != expected_version_id:
                continue
            if b.effective_from is not None and b.effective_from > target_date:
                continue
            if b.effective_until is not None and b.effective_until < target_date:
                continue
            if is_all_groups_blocked or b.group_id in blocked_groups or b.group_id in practice_groups:
                continue
            b_room = resolve_effective_room(b.room_override, b.teacher, b.second_teacher)
            b_teacher_name = resolve_teacher_names(b.teacher, b.second_teacher)
            put_cell(
                b.group_id,
                b.lesson_number,
                f"b{b.id}",
                EffectiveLesson(
                    group_id=b.group_id,
                    date=target_date,
                    lesson_number=b.lesson_number,
                    subject_id=b.subject_id,
                    teacher_id=b.teacher_id,
                    second_teacher_id=b.second_teacher_id,
                    teacher_room=resolve_own_room(b.teacher), second_teacher_room=resolve_own_room(b.second_teacher),
                    room=b_room,
                    stream_id=b.stream_id,
                    source_kind="base",
                    source_ref_id=b.id,
                    group_name=b.group.name if b.group else None,
                    subject_name=b.subject.name if b.subject else None,
                    teacher_name=b_teacher_name,
                    is_replacement=b.is_replacement,
                    has_template=True,
                ),
            )

        day_base_lessons = [
            b for b in all_base_lessons
            if b.day_of_week == weekday
            and (b.version_id == expected_version_id)
            and (b.effective_from is None or b.effective_from <= target_date)
            and (b.effective_until is None or b.effective_until >= target_date)
            and _week_matches(week_type, b.week_type)
        ]

        for imp in all_imported:
            if imp.date != target_date or imp.group_id in blocked_groups:
                continue
            key = (imp.group_id, imp.lesson_number)
            if imp.kind == "cancelled":
                for k in slot_keys(*key):
                    cells[k].is_cancelled = True
                    cells[k].source_kind = "import"
                    cells[k].source_ref_id = imp.id
            elif imp.kind == "substitution":
                imp_room_override = getattr(imp, "room_override", getattr(imp, "room", None))
                imp_room = resolve_effective_room(imp_room_override, imp.teacher, imp.second_teacher)
                imp_teacher_name = resolve_teacher_names(imp.teacher, imp.second_teacher)
                is_swap_or_move = (
                    getattr(imp, "change_type", None) in ("swap", "move")
                    or is_same_day_swap(imp.group_id, imp.subject_id, imp.teacher_id, day_base_lessons)
                )
                replace_slot(
                    *key,
                    EffectiveLesson(
                        group_id=imp.group_id,
                        date=target_date,
                        lesson_number=imp.lesson_number,
                        subject_id=imp.subject_id,
                        teacher_id=imp.teacher_id,
                        second_teacher_id=imp.second_teacher_id,
                        teacher_room=resolve_own_room(imp.teacher), second_teacher_room=resolve_own_room(imp.second_teacher),
                        room=imp_room,
                        stream_id=None,
                        source_kind="import",
                        source_ref_id=imp.id,
                        group_name=imp.group.name if imp.group else None,
                        subject_name=imp.subject.name if imp.subject else None,
                        teacher_name=imp_teacher_name,
                        is_replacement=not is_swap_or_move,
                    ),
                    f"i{imp.id}",
                )

        for ovr in all_overrides:
            if ovr.date != target_date or ovr.group_id in blocked_groups:
                continue
            key = (ovr.group_id, ovr.lesson_number)
            if ovr.cancelled:
                found = False
                for k in slot_keys(*key):
                    cells[k].is_cancelled = True
                    cells[k].source_kind = "manual"
                    cells[k].source_ref_id = ovr.id
                    cells[k].moved_to_date = getattr(ovr, "moved_to_date", None)
                    cells[k].moved_to_lesson = getattr(ovr, "moved_to_lesson", None)
                    found = True
                if not found:
                    ovr_room = resolve_effective_room(ovr.room, ovr.teacher, ovr.second_teacher)
                    ovr_teacher_name = resolve_teacher_names(ovr.teacher, ovr.second_teacher)
                    put_cell(
                        ovr.group_id,
                        ovr.lesson_number,
                        f"o{ovr.id}",
                        EffectiveLesson(
                            group_id=ovr.group_id,
                            date=target_date,
                            lesson_number=ovr.lesson_number,
                            subject_id=ovr.subject_id,
                            teacher_id=ovr.teacher_id,
                            second_teacher_id=ovr.second_teacher_id,
                            teacher_room=resolve_own_room(ovr.teacher), second_teacher_room=resolve_own_room(ovr.second_teacher),
                            room=ovr_room,
                            stream_id=ovr.stream_id,
                            source_kind="manual",
                            source_ref_id=ovr.id,
                            is_cancelled=True,
                            group_name=ovr.group.name if getattr(ovr, "group", None) else None,
                            subject_name=ovr.subject.name if ovr.subject else "Скасована пара",
                            teacher_name=ovr_teacher_name,
                            is_replacement=True,
                            moved_to_date=getattr(ovr, "moved_to_date", None),
                            moved_to_lesson=getattr(ovr, "moved_to_lesson", None),
                        ),
                    )
            else:
                ovr_room = resolve_effective_room(ovr.room, ovr.teacher, ovr.second_teacher)
                ovr_teacher_name = resolve_teacher_names(ovr.teacher, ovr.second_teacher)
                is_swap_or_move = is_same_day_swap(ovr.group_id, ovr.subject_id, ovr.teacher_id, day_base_lessons)
                replace_slot(
                    *key,
                    EffectiveLesson(
                        group_id=ovr.group_id,
                        date=target_date,
                        lesson_number=ovr.lesson_number,
                        subject_id=ovr.subject_id,
                        teacher_id=ovr.teacher_id,
                        second_teacher_id=ovr.second_teacher_id,
                        teacher_room=resolve_own_room(ovr.teacher), second_teacher_room=resolve_own_room(ovr.second_teacher),
                        room=ovr_room,
                        stream_id=ovr.stream_id,
                        source_kind="manual",
                        source_ref_id=ovr.id,
                        group_name=ovr.group.name if getattr(ovr, "group", None) else None,
                        subject_name=ovr.subject.name if ovr.subject else None,
                        teacher_name=ovr_teacher_name,
                        is_replacement=not is_swap_or_move,
                    ),
                    f"o{ovr.id}",
                )

        for ev in all_events:
            if ev.event_date != target_date:
                continue
            l_num = ev.lesson_number or infer_lesson_number(ev.start_time)
            resolved_subject = (
                (ev.custom_subject or "").strip()
                or (ev.subject.name if ev.subject else None)
                or (ev.title or "").strip()
                or "Подія"
            )
            time_str = f"{ev.start_time}-{ev.end_time}" if ev.end_time else ev.start_time
            ev_lesson = EffectiveLesson(
                group_id=ev.group_id,
                date=target_date,
                lesson_number=l_num,
                subject_id=ev.subject_id,
                teacher_id=ev.teacher_id,
                second_teacher_id=None,
                room=ev.room or (ev.teacher.room if ev.teacher and ev.teacher.room else None),
                stream_id=None,
                source_kind="event",
                source_ref_id=ev.id,
                group_name=ev.group.name if ev.group else None,
                subject_name=resolved_subject,
                teacher_name=ev.teacher.name if ev.teacher else None,
                is_replacement=True,
                event_type=ev.event_type,
                event_title=ev.title,
                custom_subject=ev.custom_subject,
                event_id=ev.id,
                time=time_str,
            )
            if ev.note:
                ev_lesson.note_text = ev.note
            replace_slot(ev.group_id, l_num, ev_lesson, f"e{ev.id}")

        results = [c for c in cells.values() if include_cancelled or not c.is_cancelled]
        if group_id:
            results = [c for c in results if c.group_id == group_id]
        if teacher_id:
            results = [c for c in results if c.teacher_id == teacher_id or c.second_teacher_id == teacher_id]

        lessons_by_day[weekday] = sorted(results, key=lambda x: x.lesson_number)

    if len(_WEEK_PROJ_CACHE) >= _WEEK_PROJ_MAX:
        oldest_key = min(_WEEK_PROJ_CACHE, key=lambda k: _WEEK_PROJ_CACHE[k][0])
        _WEEK_PROJ_CACHE.pop(oldest_key, None)
    _WEEK_PROJ_CACHE[cache_key] = (now_mono, week_type, {k: list(v) for k, v in lessons_by_day.items()})

    return week_type, lessons_by_day
