from datetime import date
from typing import Optional, List, Dict
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
    Group
)
from app.services.settings import settings_service
from app.services.week import get_week_type

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

        self.note_id: Optional[int] = None
        self.note_revision: int = 0
        self.note_text: Optional[str] = None

    @property
    def occurrence_key(self) -> str:
        return f"group_{self.group_id}_{self.date.isoformat()}_slot_{self.lesson_number}"

async def build_projection(
    db: AsyncSession, 
    target_date: date, 
    group_id: Optional[int] = None, 
    teacher_id: Optional[int] = None
) -> List[EffectiveLesson]:
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
    if any(not p.groups for p in periods if p.period_type in ("holiday", "session", "diploma", "attestation")):
        # Global holiday
        return []

    # 3. Base Schedule
    base_conds = [
        Schedule.day_of_week == weekday,
        Schedule.is_active.is_(True),
        Schedule.week_type.in_(("both", week_type)),
    ]
    if active_version:
        base_conds.append(Schedule.version_id == active_version.id)
    else:
        base_conds.append(Schedule.version_id.is_(None))

    base_query = select(Schedule).where(*base_conds).options(
        joinedload(Schedule.group), joinedload(Schedule.subject),
        joinedload(Schedule.teacher), joinedload(Schedule.second_teacher)
    )
    base_lessons = (await db.scalars(base_query)).all()

    # 4. Imported Changes
    previous_change = aliased(ImportedScheduleChange)
    latest_import_version = (
        select(previous_change.version)
        .where(
            previous_change.date == ImportedScheduleChange.date,
            previous_change.group_id == ImportedScheduleChange.group_id,
            previous_change.lesson_number == ImportedScheduleChange.lesson_number,
            previous_change.is_published.is_(True)
        )
        .order_by(previous_change.version.desc())
        .limit(1)
        .scalar_subquery()
    )

    import_query = select(ImportedScheduleChange).where(
        ImportedScheduleChange.date == target_date,
        ImportedScheduleChange.is_published.is_(True),
        ImportedScheduleChange.version == latest_import_version
    ).options(
        joinedload(ImportedScheduleChange.group), joinedload(ImportedScheduleChange.subject),
        joinedload(ImportedScheduleChange.teacher), joinedload(ImportedScheduleChange.second_teacher)
    )
    imported_changes = (await db.scalars(import_query)).all()

    # 5. Manual Overrides
    override_query = select(ScheduleOverride).where(
        ScheduleOverride.date == target_date
    ).options(
        joinedload(ScheduleOverride.subject), joinedload(ScheduleOverride.teacher),
        joinedload(ScheduleOverride.second_teacher)
    )
    overrides = (await db.scalars(override_query)).all()

    # Compute effective cells
    cells: Dict[Tuple[int, int], EffectiveLesson] = {}

    # A0. Add practice slots
    for p in periods:
        if p.period_type == "practice":
            for slot in p.slots:
                if slot.day_of_week == weekday:
                    # We might not have joined subject/teacher for slot, so we need to fetch them
                    # Or we just rely on slot.subject_id and let serialize do the rest, but serialize expects names.
                    # Wait, in the old code, does fetch_schedule join practice slots?
                    # Let's just create the EffectiveLesson.
                    cells[(slot.group_id, slot.lesson_number)] = EffectiveLesson(
                        group_id=slot.group_id, date=target_date, lesson_number=slot.lesson_number,
                        subject_id=slot.subject_id, teacher_id=slot.teacher_id, second_teacher_id=slot.second_teacher_id,
                        room=slot.room_override, stream_id=None,
                        source_kind="practice", source_ref_id=slot.id,
                        group_name=None, 
                        subject_name=slot.subject.name if slot.subject else None, 
                        teacher_name=slot.teacher.name if slot.teacher else None,
                        is_replacement=True
                    )

    # A. Fill with base
    for b in base_lessons:
        if b.group_id in blocked_groups:
            continue
        # practice groups normally don't have regular lessons, but if they do, we can skip or mark cancelled
        is_practice = b.group_id in practice_groups
        if is_practice: continue # T10 priority: practice overrides base

        cells[(b.group_id, b.lesson_number)] = EffectiveLesson(
            group_id=b.group_id, date=target_date, lesson_number=b.lesson_number,
            subject_id=b.subject_id, teacher_id=b.teacher_id, second_teacher_id=b.second_teacher_id,
            room=b.room_override, stream_id=b.stream_id,
            source_kind="base", source_ref_id=b.id,
            group_name=b.group.name if b.group else None,
            subject_name=b.subject.name if b.subject else None,
            teacher_name=b.teacher.name if b.teacher else None,
            is_replacement=b.is_replacement
        )

    # B. Apply Imported Changes
    for imp in imported_changes:
        key = (imp.group_id, imp.lesson_number)
        if imp.group_id in blocked_groups:
            continue
        if imp.kind == "cancelled":
            if key in cells:
                cells[key].is_cancelled = True
                cells[key].source_kind = "import"
                cells[key].source_ref_id = imp.id
        elif imp.kind == "substitution":
            cells[key] = EffectiveLesson(
                group_id=imp.group_id, date=target_date, lesson_number=imp.lesson_number,
                subject_id=imp.subject_id, teacher_id=imp.teacher_id, second_teacher_id=imp.second_teacher_id,
                room=getattr(imp, 'room', None), stream_id=None,
                source_kind="import", source_ref_id=imp.id,
                group_name=imp.group.name if imp.group else None,
                subject_name=imp.subject.name if imp.subject else None,
                teacher_name=imp.teacher.name if imp.teacher else None,
                is_replacement=True
            )

    # C. Apply Manual Overrides
    for ovr in overrides:
        key = (ovr.group_id, ovr.lesson_number)
        if ovr.group_id in blocked_groups:
            continue
        if ovr.cancelled:
            if key in cells:
                cells[key].is_cancelled = True
                cells[key].source_kind = "manual"
                cells[key].source_ref_id = ovr.id
        else:
            # Add or replace
            cells[key] = EffectiveLesson(
                group_id=ovr.group_id, date=target_date, lesson_number=ovr.lesson_number,
                subject_id=ovr.subject_id, teacher_id=ovr.teacher_id, second_teacher_id=ovr.second_teacher_id,
                room=ovr.room, stream_id=ovr.stream_id,
                source_kind="manual", source_ref_id=ovr.id,
                # We might need a separate query for group name if it's an addition without schedule_id
                # but for now we skip filling names, can be joined or handled.
                subject_name=ovr.subject.name if ovr.subject else None,
                teacher_name=ovr.teacher.name if ovr.teacher else None,
                is_replacement=True
            )

    # Filter results
    results = [c for c in cells.values() if not c.is_cancelled]

    if group_id:
        results = [c for c in results if c.group_id == group_id]
    if teacher_id:
        results = [c for c in results if c.teacher_id == teacher_id or c.second_teacher_id == teacher_id]

    # Optional: bind notes (T06)
    # We can do this in a separate pass or here.
    from app.models.lesson_notes import LessonOccurrenceNote
    # ... logic to attach notes ...

    return sorted(results, key=lambda x: x.lesson_number)
