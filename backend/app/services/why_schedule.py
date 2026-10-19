"""Diagnostic service: 'Чому так?' (Why this schedule result?).
Explains layer-by-layer contribution to effective schedule and notes.
"""
from datetime import date, timedelta
from typing import Any, Optional, Dict, List
import json

from sqlalchemy import select, or_, and_
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    Group,
    Teacher,
    Subject,
    Schedule,
    ScheduleVersion,
    SchedulePeriod,
    SchedulePeriodSlot,
    ScheduleOverride,
    ImportedScheduleChange,
    SchedulePublication,
    AcademicEvent,
)
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.settings import settings_service
from app.services.week import get_week_type
from app.services.projection import (
    resolve_effective_room,
    resolve_teacher_names,
    infer_lesson_number,
)


async def explain_schedule_slot(
    db: AsyncSession,
    target_date: date,
    group_id: Optional[int] = None,
    teacher_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Produces a step-by-step explanation of what determines the schedule for a given date."""
    # 0. Resolve target entity
    group = await db.get(Group, group_id) if group_id else None
    teacher = await db.get(Teacher, teacher_id) if teacher_id else None

    # 1. Version
    active_version = await db.scalar(
        select(ScheduleVersion).where(
            ScheduleVersion.valid_from <= target_date,
            ScheduleVersion.valid_until >= target_date,
            ScheduleVersion.is_active.is_(True)
        ).order_by(ScheduleVersion.valid_from.desc()).limit(1)
    )
    all_versions = (await db.scalars(select(ScheduleVersion).order_by(ScheduleVersion.valid_from.desc()))).all()

    # 2. Week type calculation
    semester_start = await settings_service.get_semester_start(db)
    start_monday = semester_start - timedelta(days=semester_start.weekday())
    target_monday = target_date - timedelta(days=target_date.weekday())
    weeks_diff = (target_monday - start_monday).days // 7
    week_type = "numerator" if weeks_diff % 2 == 0 else "denominator"
    week_type_ukr = "Чисельник" if week_type == "numerator" else "Знаменник"

    week_calc_explanation = (
        f"Початок семестру: {semester_start.isoformat()} (понеділок {start_monday.isoformat()}). "
        f"Цільовий понеділок: {target_monday.isoformat()}. "
        f"Різниця тижнів: {weeks_diff} (парне -> Чисельник, непарне -> Знаменник). "
        f"Результат: {week_type_ukr} ({week_type})."
    )

    weekday = target_date.isoweekday()

    # 3. Calendar Periods (Графік процесу)
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
    periods_info = []
    blocked = False
    practice_slots = []
    for p in periods:
        applies_to_group = any(g.id == group_id for g in p.groups) if group_id else True
        is_global = len(p.groups) == 0
        applies = applies_to_group or is_global
        p_desc = {
            "period_id": p.id,
            "name": p.name,
            "period_type": p.period_type,
            "dates": f"{p.start_date.isoformat()}..{p.end_date.isoformat()}",
            "is_global": is_global,
            "applies_to_target": applies,
        }
        periods_info.append(p_desc)
        if applies:
            if p.period_type in ("holiday", "session", "diploma", "attestation"):
                blocked = True
            elif p.period_type == "practice":
                for sl in p.slots:
                    if sl.day_of_week == weekday and (group_id is None or sl.group_id == group_id):
                        practice_slots.append(sl)

    # 4. Base Template Slots
    template_conds = [
        Schedule.day_of_week == weekday,
        Schedule.is_active.is_(True),
    ]
    if active_version:
        template_conds.append(Schedule.version_id == active_version.id)
    else:
        template_conds.append(Schedule.version_id.is_(None))
    if group_id:
        template_conds.append(Schedule.group_id == group_id)
    if teacher_id:
        template_conds.append(or_(Schedule.teacher_id == teacher_id, Schedule.second_teacher_id == teacher_id))

    template_all_rows = (await db.scalars(
        select(Schedule).where(*template_conds).options(
            joinedload(Schedule.subject), joinedload(Schedule.teacher), joinedload(Schedule.second_teacher)
        )
    )).all()

    # Filter by week_type
    template_matching_rows = [
        r for r in template_all_rows
        if r.week_type in ("both", week_type)
        and (r.effective_from is None or r.effective_from <= target_date)
        and (r.effective_until is None or r.effective_until >= target_date)
    ]
    template_other_week_rows = [
        r for r in template_all_rows
        if r.week_type not in ("both", week_type)
    ]

    # Check if there are template rows in OTHER versions or unassigned
    other_version_rows = (await db.scalars(
        select(Schedule).where(
            Schedule.day_of_week == weekday,
            Schedule.is_active.is_(True),
            Schedule.group_id == group_id if group_id else True,
            Schedule.version_id != (active_version.id if active_version else -1)
        ).options(joinedload(Schedule.subject), joinedload(Schedule.version))
    )).all()

    # 5. Imported Changes
    imported_changes = (await db.scalars(
        select(ImportedScheduleChange).where(
            ImportedScheduleChange.date == target_date,
            ImportedScheduleChange.group_id == group_id if group_id else True,
            ImportedScheduleChange.is_published.is_(True),
        ).options(
            joinedload(ImportedScheduleChange.subject),
            joinedload(ImportedScheduleChange.teacher),
        ).order_by(ImportedScheduleChange.lesson_number, ImportedScheduleChange.version.desc())
    )).all()

    # 6. Manual Overrides
    overrides = (await db.scalars(
        select(ScheduleOverride).where(
            ScheduleOverride.date == target_date,
            ScheduleOverride.group_id == group_id if group_id else True,
        ).options(
            joinedload(ScheduleOverride.subject),
            joinedload(ScheduleOverride.teacher),
        ).order_by(ScheduleOverride.lesson_number)
    )).all()

    # 7. Academic Events
    events = (await db.scalars(
        select(AcademicEvent).where(
            AcademicEvent.event_date == target_date,
            AcademicEvent.group_id == group_id if group_id else True,
        ).options(
            joinedload(AcademicEvent.subject),
            joinedload(AcademicEvent.teacher),
        ).order_by(AcademicEvent.lesson_number)
    )).all()

    # 8. Notes & Meeting Links & Tasks
    notes = (await db.scalars(
        select(LessonOccurrenceNote).where(
            LessonOccurrenceNote.note_date == target_date,
            LessonOccurrenceNote.group_id == group_id if group_id else True,
        ).order_by(LessonOccurrenceNote.lesson_number, LessonOccurrenceNote.id.desc())
    )).all()

    # Per-slot detailed synthesis (lessons 1..4)
    slots_breakdown = []
    for l_num in range(1, 5):
        slot_desc = {
            "lesson_number": l_num,
            "template": None,
            "period_override": None,
            "imported_change": None,
            "manual_override": None,
            "event": None,
            "effective_lesson": None,
            "notes_active": [],
            "notes_archived": [],
            "meeting_links": [],
            "homework_tasks": [],
            "anomaly_warning": None,
        }

        # Template
        tpl = next((r for r in template_matching_rows if r.lesson_number == l_num), None)
        other_tpl = next((r for r in template_other_week_rows if r.lesson_number == l_num), None)
        if tpl:
            slot_desc["template"] = {
                "id": tpl.id,
                "version_id": tpl.version_id,
                "subject": tpl.subject.name if tpl.subject else None,
                "teacher": tpl.teacher.name if tpl.teacher else None,
                "room": tpl.room_override,
                "week_type": tpl.week_type,
            }
        elif other_tpl:
            slot_desc["template"] = {
                "notice": f"В активній версії слот існує ЛИШЕ для протилежного типу тижня '{other_tpl.week_type}' (id={other_tpl.id})",
                "subject": other_tpl.subject.name if other_tpl.subject else None,
                "week_type": other_tpl.week_type,
            }

        # Practice / Period
        if practice_slots:
            pslot = next((s for s in practice_slots if s.lesson_number == l_num), None)
            if pslot:
                slot_desc["period_override"] = {
                    "source": "practice",
                    "subject": pslot.subject.name if pslot.subject else None,
                    "teacher": pslot.teacher.name if pslot.teacher else None,
                }

        # Imported change
        imp = next((i for i in imported_changes if i.lesson_number == l_num), None)
        if imp:
            slot_desc["imported_change"] = {
                "id": imp.id,
                "kind": imp.kind,
                "publication_id": imp.publication_id,
                "published_at": None,
                "pub_source": None,
                "subject": imp.subject.name if imp.subject else None,
                "teacher": imp.teacher.name if imp.teacher else None,
                "room": imp.room_override,
                "manually_edited": imp.manually_edited,
                "version": imp.version,
            }

        # Override
        ovr = next((o for o in overrides if o.lesson_number == l_num), None)
        if ovr:
            slot_desc["manual_override"] = {
                "id": ovr.id,
                "cancelled": ovr.cancelled,
                "subject": ovr.subject.name if ovr.subject else None,
                "teacher": ovr.teacher.name if ovr.teacher else None,
                "room": ovr.room,
                "moved_to_date": ovr.moved_to_date.isoformat() if ovr.moved_to_date else None,
                "moved_to_lesson": ovr.moved_to_lesson,
            }

        # Event
        ev = next((e for e in events if e.lesson_number == l_num), None)
        if ev:
            slot_desc["event"] = {
                "id": ev.id,
                "event_type": ev.event_type,
                "title": ev.title,
                "custom_subject": ev.custom_subject,
            }

        # Effective resolution
        if blocked:
            slot_desc["effective_lesson"] = {"status": "blocked_by_period", "summary": "Заняття скасовано періодом (сесія/канікули/диплом)"}
        elif ev:
            slot_desc["effective_lesson"] = {"source": "event", "summary": ev.title or ev.custom_subject}
        elif ovr:
            if ovr.cancelled:
                slot_desc["effective_lesson"] = {"source": "manual", "status": "cancelled", "summary": "Скасовано вручну"}
            else:
                slot_desc["effective_lesson"] = {"source": "manual", "status": "substitution", "summary": ovr.subject.name if ovr.subject else "Пара"}
        elif imp:
            if imp.kind == "cancelled":
                slot_desc["effective_lesson"] = {"source": "import", "status": "cancelled", "summary": "Скасовано імпортом"}
            else:
                slot_desc["effective_lesson"] = {"source": "import", "status": "substitution", "summary": imp.subject.name if imp.subject else "Заміна"}
        elif slot_desc["period_override"]:
            slot_desc["effective_lesson"] = {"source": "practice", "summary": slot_desc["period_override"]["subject"]}
        elif tpl:
            slot_desc["effective_lesson"] = {"source": "base_template", "summary": tpl.subject.name if tpl.subject else "Пара"}
        else:
            slot_desc["effective_lesson"] = {"source": "none", "summary": "Немає заняття"}
            if other_tpl:
                slot_desc["anomaly_warning"] = (
                    f"УВАГА: Шаблон має заняття для '{other_tpl.week_type}', але поточний день розрахований як '{week_type}'. "
                    f"Якщо Чисельник у цій версії порожній через помилку імпорту, пара не показується."
                )

        # Notes breakdown
        slot_notes = [n for n in notes if n.lesson_number == l_num]
        for sn in slot_notes:
            n_data = {
                "id": sn.id,
                "origin_kind": sn.origin_kind,
                "origin_id": sn.origin_id,
                "archived": sn.archived,
                "revision": sn.revision,
                "created_at": sn.created_at.isoformat() if sn.created_at else None,
                "updated_at": sn.updated_at.isoformat() if sn.updated_at else None,
                "text": sn.note,
            }
            if sn.archived:
                slot_desc["notes_archived"].append(n_data)
            else:
                slot_desc["notes_active"].append(n_data)

            # Extract links and tasks
            for line in (sn.note or "").split("\n"):
                line_s = line.strip()
                if "meet.google.com" in line_s or "zoom.us" in line_s:
                    slot_desc["meeting_links"].append({
                        "link": line_s,
                        "origin_kind": sn.origin_kind,
                        "archived": sn.archived,
                        "note_id": sn.id,
                    })
                if line_s.startswith("[TASK]"):
                    slot_desc["homework_tasks"].append({
                        "task": line_s,
                        "archived": sn.archived,
                        "note_id": sn.id,
                    })

        slots_breakdown.append(slot_desc)

    return {
        "query": {
            "date": target_date.isoformat(),
            "weekday": weekday,
            "group_id": group_id,
            "group_name": group.name if group else None,
            "teacher_id": teacher_id,
            "teacher_name": teacher.name if teacher else None,
        },
        "layers": {
            "version": {
                "active_version": {
                    "id": active_version.id,
                    "name": active_version.name,
                    "valid_from": active_version.valid_from.isoformat(),
                    "valid_until": active_version.valid_until.isoformat(),
                    "is_active": active_version.is_active,
                } if active_version else None,
                "available_versions_count": len(all_versions),
            },
            "week_type": {
                "type": week_type,
                "label": week_type_ukr,
                "calculation": week_calc_explanation,
            },
            "calendar_periods": periods_info,
            "template_summary": {
                "matching_slots_count": len(template_matching_rows),
                "other_week_slots_count": len(template_other_week_rows),
                "other_versions_slots_count": len(other_version_rows),
            },
            "imported_changes_count": len(imported_changes),
            "manual_overrides_count": len(overrides),
            "academic_events_count": len(events),
            "total_notes_count": len(notes),
        },
        "slots": slots_breakdown,
    }
