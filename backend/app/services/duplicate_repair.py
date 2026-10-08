"""Reviewed, snapshot-bound soft repair. No physical deletion or FK remapping."""
import hashlib
import json
from collections import defaultdict
from sqlalchemy import MetaData,Table,inspect,select,func,text,update
from app.models import Schedule,ScheduleVersion
from app.services.import_slot_safety import coverage

class RepairRefused(RuntimeError):
    pass

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()

def signature(row):
    return tuple((name,row[name]) for name in sorted(row) if name not in ('id','is_active'))

async def read_state(conn):
    inspector_tables=await conn.run_sync(lambda c:inspect(c).get_table_names())
    if 'schedule' not in inspector_tables or 'schedule_versions' not in inspector_tables:
        raise RepairRefused('required_schema_missing')
    actual=set(await conn.run_sync(lambda c:[x['name'] for x in inspect(c).get_columns('schedule')]))
    if actual != set(Schedule.__table__.columns.keys()):
        raise RepairRefused('schedule_schema_changed')
    rows=[dict(r) for r in (await conn.execute(select(Schedule.__table__).order_by(Schedule.id).limit(50001))).mappings()]
    if len(rows)>50000: raise RepairRefused('too_many_rows_for_complete_plan')
    versions=[dict(r) for r in (await conn.execute(select(ScheduleVersion.__table__).order_by(ScheduleVersion.id))).mappings()]
    active_versions=[v for v in versions if v['is_active']]
    for version in versions:
        if version['valid_from']>version['valid_until']: raise RepairRefused('invalid_version_dates')
    for i,a in enumerate(active_versions):
        for b in active_versions[i+1:]:
            if a['valid_from']<=b['valid_until'] and b['valid_from']<=a['valid_until']:
                raise RepairRefused('active_version_overlap')
    active=[r for r in rows if r['is_active']]
    sets=defaultdict(list);cells={}
    for row in active:
        if row['day_of_week'] not in range(1,6) or row['lesson_number'] not in range(1,5):
            raise RepairRefused('invalid_schedule_slot')
        try: weeks=coverage(row['week_type'])
        except Exception as exc: raise RepairRefused('invalid_week_type') from exc
        sig=signature(row);sets[sig].append(row['id'])
        cell=(row['group_id'],row['version_id'],row['day_of_week'],row['lesson_number'])
        assignment=tuple((k,row[k]) for k in sorted(row) if k not in ('id','is_active','week_type'))
        for week in weeks:
            key=(*cell,week)
            old=cells.get(key)
            if old and old[0]!=assignment: raise RepairRefused('overlapping_assignment_conflict')
            if old and old[1]!=row['week_type']: raise RepairRefused('non_exact_week_overlap_requires_review')
            cells[key]=(assignment,row['week_type'])
    groups=[sorted(ids) for ids in sets.values() if len(ids)>1]
    candidate_ids={id for ids in groups for id in ids}
    references=[];source_columns=set();source_tables=set()
    for name in sorted(inspector_tables):
        fks=await conn.run_sync(lambda c,n=name:inspect(c).get_foreign_keys(n))
        for fk in fks:
            if fk.get('referred_table')!='schedule':continue
            if fk.get('referred_schema') not in (None,'public') or fk['referred_columns']!=['id'] or len(fk['constrained_columns'])!=1:
                raise RepairRefused('unsupported_schedule_reference')
            source_columns.add((name,fk['constrained_columns'][0]));source_tables.add(name)
    for name in ('lesson_notes','lesson_occurrence_notes'):
        if name not in inspector_tables:continue
        columns=set(await conn.run_sync(lambda c,n=name:[x['name'] for x in inspect(c).get_columns(n)]))
        source_tables.add(name)
        if 'schedule_id' in columns:source_columns.add((name,'schedule_id'))
        elif await conn.scalar(text(f'SELECT COUNT(*) FROM {name}')):
            raise RepairRefused('occurrence_notes_require_review')
    for name,column in sorted(source_columns):
        table=await conn.run_sync(lambda c,n=name:Table(n,MetaData(),autoload_with=c))
        # Only counts, never note content. Query in bounded chunks for SQLite/driver limits.
        ids=sorted(candidate_ids)
        for start in range(0,len(ids),400):
            values=(await conn.execute(select(table.c[column],func.count()).where(table.c[column].in_(ids[start:start+400])).group_by(table.c[column]))).all()
            references.extend([{'table':name,'column':column,'schedule_id':id,'count':count} for id,count in values])
    if references:
        # No clever automatic remapping. Protect any referenced duplicate group.
        raise RepairRefused('duplicate_rows_have_references_requires_manual_mapping')
    revisions=list((await conn.scalars(text('SELECT version_num FROM alembic_version'))).all()) if 'alembic_version' in inspector_tables else []
    snapshot={'schedule':rows,'versions':versions,'source_columns':sorted(source_columns),
              'source_tables':sorted(source_tables),'tables':sorted(inspector_tables),'revisions':sorted(revisions),'references':references}
    by_id={r['id']:r for r in rows}
    actions=[]
    for ids in sorted(groups,key=lambda ids:ids[0]):
        row=by_id[ids[0]]
        actions.append({'keep_id':ids[0],'deactivate_ids':ids[1:],'count':len(ids),
                        'group_id':row['group_id'],'version_id':row['version_id'],
                        'day_of_week':row['day_of_week'],'lesson_number':row['lesson_number'],
                        'week_type':row['week_type'],'assignment_hash':digest(dict(signature(row)))})
    core={'format_version':1,'operation':'soft_deactivate_exact_duplicates','database_state_hash':digest(snapshot),
          'active_before':len(active),'duplicate_set_count':len(actions),
          'deactivate_count':sum(len(a['deactivate_ids']) for a in actions),'actions':actions}
    plan={**core,'plan_hash':digest(core)}
    return plan,source_tables

async def create_plan(conn):
    return (await read_state(conn))[0]

async def apply_reviewed_plan(conn,reviewed,*,allow_sqlite_test=False):
    if conn.dialect.name=='postgresql':
        await conn.execute(text("SET LOCAL lock_timeout='5s'"))
        for key in (424243,424242):
            if not await conn.scalar(text('SELECT pg_try_advisory_xact_lock(:key)'),{'key':key}):
                raise RepairRefused('another_mutation_or_import_is_running')
        await conn.execute(text('LOCK TABLE schedule, schedule_versions IN SHARE ROW EXCLUSIVE MODE'))
        # Inspect first, then lock source-reference tables before authoritative revalidation.
        _,source_tables=await read_state(conn)
        preparer=conn.dialect.identifier_preparer
        for name in sorted(source_tables):
            await conn.execute(text('LOCK TABLE '+preparer.quote(name)+' IN SHARE ROW EXCLUSIVE MODE'))
    elif not (allow_sqlite_test and conn.dialect.name=='sqlite'):
        raise RepairRefused('apply_requires_postgresql')
    current,_=await read_state(conn)
    if current!=reviewed:raise RepairRefused('stale_or_modified_plan_regenerate_and_review')
    ids=[id for action in current['actions'] for id in action['deactivate_ids']]
    affected=0
    for start in range(0,len(ids),400):
        result=await conn.execute(update(Schedule.__table__).where(Schedule.id.in_(ids[start:start+400]),Schedule.is_active.is_(True)).values(is_active=False))
        affected+=result.rowcount
    if affected!=len(ids):raise RepairRefused('unexpected_affected_row_count')
    after,_=await read_state(conn)
    if after['active_before']!=current['active_before']-len(ids) or after['duplicate_set_count']:
        raise RepairRefused('post_repair_verification_failed')
    return {'status':'applied','operation':current['operation'],'plan_hash':current['plan_hash'],
            'before_state_hash':current['database_state_hash'],'after_state_hash':after['database_state_hash'],
            'active_before':current['active_before'],'active_after':after['active_before'],
            'deactivated_count':len(ids),'deactivated_ids':ids,
            'kept_ids':[a['keep_id'] for a in current['actions']],
            'physical_deletions':0,'references_remapped':0}
