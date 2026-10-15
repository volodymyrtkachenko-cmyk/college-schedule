"""Fail-closed safeguards for recurring import slots; never delete existing data."""
from datetime import date
from fastapi import HTTPException
from sqlalchemy import inspect, select, text, func
from app.models import ScheduleVersion, ScheduleOverride

WEEKS = {'numerator', 'denominator', 'both'}

def coverage(week_type):
    if week_type not in WEEKS:
        raise HTTPException(422, detail={'code':'invalid_import_week_type'})
    return {'numerator','denominator'} if week_type == 'both' else {week_type}

def slot_assignment(slot):
    room = slot.get('room')
    room = room.strip() if isinstance(room,str) and room.strip() else None
    return (slot['subject_id'],slot.get('teacher_id'),slot.get('second_teacher_id'),
            room,slot.get('stream_id'),bool(slot.get('is_replacement',False)))

def normalize_base_slots(slots, *, prefer_incoming: bool = False):
    """Merge identical assignments/week coverage; when prefer_incoming=True, newer slot wins."""
    assignments = {}
    occupied = {}
    for original in slots:
        slot = dict(original)
        if not isinstance(slot.get('group_id'), int) or slot['group_id'] <= 0:
            raise HTTPException(422, detail={'code': 'invalid_import_group'})
        if slot.get('day_of_week') not in range(1, 6) or slot.get('lesson_number') not in range(1, 5):
            raise HTTPException(422, detail={'code': 'invalid_import_slot'})
        cell = (slot['group_id'], slot['day_of_week'], slot['lesson_number'])
        assignment = slot_assignment(slot)
        weeks = coverage(slot.get('week_type', 'both'))
        for week in weeks:
            key = (*cell, week)
            if key in occupied and occupied[key] != assignment:
                if prefer_incoming:
                    old_assignment = occupied[key]
                    old_entry = assignments.get((cell, old_assignment))
                    if old_entry:
                        old_entry[1].discard(week)
                        if not old_entry[1]:
                            del assignments[(cell, old_assignment)]
                else:
                    raise HTTPException(409, detail={
                        'code': 'import_cell_conflict', 'group_id': cell[0],
                        'day_of_week': cell[1], 'lesson_number': cell[2], 'week_type': week,
                        'msg': 'Різні заняття перетинаються в одному слоті. Потрібен ручний розгляд; запис не виконано.',
                    })
            occupied[key] = assignment
        key = (cell, assignment)
        if key not in assignments:
            slot['room'] = assignment[3]
            assignments[key] = (slot, set(weeks))
        else:
            assignments[key][1].update(weeks)
    result = []
    for slot, weeks in assignments.values():
        if not weeks:
            continue
        slot['week_type'] = 'both' if len(weeks) == 2 else next(iter(weeks))
        result.append(slot)
    return sorted(result, key=lambda s: (s['group_id'], s['day_of_week'], s['lesson_number'], s['week_type']))

async def version_for_date(db,target_date):
    ids=list((await db.scalars(select(ScheduleVersion.id).where(
        ScheduleVersion.is_active.is_(True),ScheduleVersion.valid_from <= target_date,
        ScheduleVersion.valid_until >= target_date,
    ).order_by(ScheduleVersion.id).limit(2))).all())
    if len(ids)>1:
        raise HTTPException(409,detail={'code':'ambiguous_active_version','msg':'На дату діють кілька версій. Спочатку усуньте перетин.'})
    return ids[0] if ids else None

async def version_for_import(db,date_strings,fallback_date):
    dates=sorted({date.fromisoformat(value) for value in date_strings}) or [fallback_date]
    ids={await version_for_date(db,d) for d in dates}
    if len(ids)>1:
        raise HTTPException(409,detail={'code':'import_spans_versions','msg':'Імпорт охоплює різні версії. Розділіть його за періодами; змішування шаблонів заборонено.'})
    return next(iter(ids))
