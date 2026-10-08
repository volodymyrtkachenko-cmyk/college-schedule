"""Read-only diagnostics. No DELETE/UPDATE, migrations, token or note-text output."""
import asyncio
import json
import sys
from pathlib import Path
from collections import defaultdict
from sqlalchemy import inspect,text
from app.database import engine
from app.services.import_slot_safety import coverage,slot_assignment

MAX_ROWS=50000
MAX_SETS=200
MAX_IDS=100

async def collect():
    if engine.dialect.name=='sqlite':
        path=engine.url.database
        if not path or path==':memory:' or not Path(path).is_file():
            raise FileNotFoundError('An existing SQLite file is required; no empty DB will be created')
    async with engine.connect() as conn:
        if conn.dialect.name=='postgresql': await conn.execute(text('SET TRANSACTION READ ONLY'))
        elif conn.dialect.name=='sqlite': await conn.execute(text('PRAGMA query_only=ON'))
        else: raise RuntimeError('Unsupported diagnostic dialect')
        tables=set(await conn.run_sync(lambda c:inspect(c).get_table_names()))
        report={'mode':'read_only','dialect':conn.dialect.name,'approved_to_delete':False,
                'approved_to_run_migrations':False,'schedule_table_exists':'schedule' in tables,
                'lesson_notes_table_exists':'lesson_notes' in tables,
                'occurrence_notes_table_exists':'lesson_occurrence_notes' in tables}
        report['alembic_revisions']=list((await conn.scalars(text('SELECT version_num FROM alembic_version'))).all()) if 'alembic_version' in tables else []
        for table in ('lesson_notes','lesson_occurrence_notes','schedule_override'):
            if table in tables: report[table+'_count']=await conn.scalar(text(f'SELECT COUNT(*) FROM {table}'))
        if {'schedule_override','schedule'} <= tables:
            report['orphan_override_count']=await conn.scalar(text('SELECT COUNT(*) FROM schedule_override o LEFT JOIN schedule s ON s.id=o.schedule_id WHERE s.id IS NULL'))
        report.update(exact_duplicate_sets=[],overlapping_assignment_conflicts=[],invalid_schedule_ids=[],truncated=False)
        if 'schedule' in tables:
            total=await conn.scalar(text('SELECT COUNT(*) FROM schedule WHERE is_active'))
            rows=(await conn.execute(text('SELECT id,group_id,version_id,subject_id,teacher_id,second_teacher_id,stream_id,day_of_week,lesson_number,week_type,room_override AS room,is_replacement FROM schedule WHERE is_active ORDER BY id LIMIT 50000'))).mappings().all()
            exact=defaultdict(list);cells=defaultdict(dict)
            for row in rows:
                row=dict(row);cell=(row['group_id'],row['version_id'],row['day_of_week'],row['lesson_number'])
                assignment=slot_assignment(row)
                exact[(*cell,row['week_type'],assignment)].append(row['id'])
                try:
                    weeks=coverage(row['week_type'])
                    if row['day_of_week'] not in range(1,6) or row['lesson_number'] not in range(1,5): raise ValueError('Invalid slot')
                except Exception:
                    report['invalid_schedule_ids'].append(row['id']);continue
                for week in weeks:
                    cells[(*cell,week)].setdefault(assignment,[]).append(row['id'])
            duplicates=[{'group_id':key[0],'version_id':key[1],'day_of_week':key[2],'lesson_number':key[3],
                         'week_type':key[4],'count':len(ids),'schedule_ids':ids[:MAX_IDS]} for key,ids in exact.items() if len(ids)>1]
            conflicts=[{'group_id':key[0],'version_id':key[1],'day_of_week':key[2],'lesson_number':key[3],
                        'week_type':key[4],'distinct_assignments':len(values),'schedule_ids':sorted(id for ids in values.values() for id in ids)[:MAX_IDS]} for key,values in cells.items() if len(values)>1]
            report.update(active_schedule_count=total,scanned_schedule_count=len(rows),
                exact_duplicate_sets=duplicates[:MAX_SETS],overlapping_assignment_conflicts=conflicts[:MAX_SETS],
                exact_duplicate_sets_found=len(duplicates),overlapping_conflicts_found=len(conflicts),
                truncated=total>len(rows) or len(duplicates)>MAX_SETS or len(conflicts)>MAX_SETS or any(len(ids)>MAX_IDS for ids in exact.values()))
        if 'schedule_versions' in tables:
            report['active_version_overlap_pairs']=[list(row) for row in (await conn.execute(text('SELECT a.id,b.id FROM schedule_versions a JOIN schedule_versions b ON a.id<b.id AND a.is_active AND b.is_active AND a.valid_from<=b.valid_until AND b.valid_from<=a.valid_until'))).all()]
        await conn.rollback()
    return report

async def run():
    try:
        report=await collect()
        problems=not report['schedule_table_exists'] or report['exact_duplicate_sets'] or report['overlapping_assignment_conflicts'] or report['invalid_schedule_ids'] or report['truncated'] or report.get('active_version_overlap_pairs')
        code=2 if problems else 0
    except Exception as exc:
        report={'mode':'read_only','status':'failed','error_type':type(exc).__name__,
                'approved_to_delete':False,'approved_to_run_migrations':False}
        code=1
    finally:
        await engine.dispose()
    encoded=json.dumps(report,ensure_ascii=False,indent=2)+'\n'
    print(encoded,end='')
    if len(sys.argv)>1:
        # Failure reports also overwrite the output, so stale success cannot be reused.
        Path(sys.argv[1]).write_text(encoded)
    return code

if __name__=='__main__': raise SystemExit(asyncio.run(run()))
