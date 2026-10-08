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

def normalize_base_slots(slots):
    """Merge identical assignments/week coverage; reject different overlapping assignments."""
    assignments = {}
    occupied = {}
    for original in slots:
        slot = dict(original)
        if not isinstance(slot.get('group_id'),int) or slot['group_id'] <= 0:
            raise HTTPException(422,detail={'code':'invalid_import_group'})
        if slot.get('day_of_week') not in range(1,6) or slot.get('lesson_number') not in range(1,5):
            raise HTTPException(422,detail={'code':'invalid_import_slot'})
        cell = (slot['group_id'],slot['day_of_week'],slot['lesson_number'])
        assignment = slot_assignment(slot)
        weeks = coverage(slot.get('week_type','both'))
        for week in weeks:
            key = (*cell,week)
            if key in occupied and occupied[key] != assignment:
                raise HTTPException(409,detail={
                    'code':'import_cell_conflict','group_id':cell[0],
                    'day_of_week':cell[1],'lesson_number':cell[2],'week_type':week,
                    'msg':'Різні заняття перетинаються в одному слоті. Потрібен ручний розгляд; запис не виконано.',
                })
            occupied[key]=assignment
        key = (cell,assignment)
        if key not in assignments:
            slot['room']=assignment[3]
            assignments[key]=(slot,set(weeks))
        else:
            assignments[key][1].update(weeks)
    result=[]
    for slot,weeks in assignments.values():
        slot['week_type']='both' if len(weeks)==2 else next(iter(weeks))
        result.append(slot)
    return sorted(result,key=lambda s:(s['group_id'],s['day_of_week'],s['lesson_number'],s['week_type']))

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

async def guard_protected_replacement(db,schedule_ids):
    """Stop destructive v4 publish until a reviewed mapping is implemented in 2B."""
    if not schedule_ids:
        return
    overrides=await db.scalar(select(func.count()).select_from(ScheduleOverride).where(
        ScheduleOverride.schedule_id.in_(schedule_ids)))
    if overrides:
        raise HTTPException(409,detail={'code':'manual_overrides_require_mapping',
            'msg':'Публікація зачіпає ручні overrides. Потрібен mapping; їх видалення заблоковано.'})
    conn=await db.connection()
    tables=set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
    for table in ('lesson_notes','lesson_occurrence_notes'):
        if table not in tables:
            continue
        columns=set(await conn.run_sync(lambda c: [x['name'] for x in inspect(c).get_columns(table)]))
        if table=='lesson_notes' and 'schedule_id' in columns:
            # SQLAlchemy reflects the legacy table only; no note text is loaded.
            from sqlalchemy import Table,MetaData
            reflected=await conn.run_sync(lambda c: Table(table,MetaData(),autoload_with=c))
            count=await db.scalar(select(func.count()).select_from(reflected).where(reflected.c.schedule_id.in_(schedule_ids)))
        else:
            # Unknown/future note structure: conservative gate, not an unsafe guess.
            count=await conn.scalar(text(f'SELECT COUNT(*) FROM {table}'))
        if count:
            raise HTTPException(409,detail={'code':'lesson_notes_require_mapping',
                'msg':'Публікація може зачепити примітки. Спочатку потрібен безпечний mapping групи 2B.'})
