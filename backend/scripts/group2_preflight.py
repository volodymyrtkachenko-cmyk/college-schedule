"""Read-only group 2 preflight. No migration, write, export of note text or secrets."""
import asyncio
import json
import sys
from pathlib import Path
from sqlalchemy import inspect, text
from app.database import engine

async def main():
    async with engine.connect() as conn:
        if conn.dialect.name == 'postgresql':
            await conn.execute(text('SET TRANSACTION READ ONLY'))
        elif conn.dialect.name == 'sqlite':
            await conn.execute(text('PRAGMA query_only=ON'))
        else:
            raise RuntimeError('Unsupported database for read-only preflight')
        tables = set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
        report = {'mode': 'read_only', 'dialect': conn.dialect.name,
                  'lesson_notes_table_exists': 'lesson_notes' in tables,
                  'new_occurrence_notes_table_exists': 'lesson_occurrence_notes' in tables}
        if 'alembic_version' in tables:
            report['alembic_revisions'] = list((await conn.scalars(text('SELECT version_num FROM alembic_version'))).all())
        else:
            report['alembic_revisions'] = []
        for table in ('lesson_notes', 'schedule_override'):
            if table in tables:
                report[f'{table}_count'] = await conn.scalar(text(f'SELECT COUNT(*) FROM {table}'))
        if 'lesson_notes' in tables:
            report['lesson_notes_columns'] = await conn.run_sync(lambda c: [x['name'] for x in inspect(c).get_columns('lesson_notes')])
        if {'schedule_override','schedule'} <= tables:
            report['orphan_overrides_count'] = await conn.scalar(text('SELECT COUNT(*) FROM schedule_override o LEFT JOIN schedule s ON s.id=o.schedule_id WHERE s.id IS NULL'))
        if 'schedule_versions' in tables:
            report['invalid_version_ids'] = list((await conn.scalars(text("SELECT id FROM schedule_versions WHERE valid_from > valid_until OR valid_from IS NULL OR valid_until IS NULL OR name IS NULL OR length(trim(name))=0 OR length(name)>255"))).all())
            pairs = (await conn.execute(text('SELECT a.id,b.id FROM schedule_versions a JOIN schedule_versions b ON a.id<b.id AND a.is_active AND b.is_active AND a.valid_from<=b.valid_until AND b.valid_from<=a.valid_until'))).all()
            report['active_overlap_pairs'] = [list(row) for row in pairs]
        else:
            report['invalid_version_ids'] = []
            report['active_overlap_pairs'] = []
        report['requires_legacy_notes_preservation'] = report['lesson_notes_table_exists']
        report['ready_for_version_constraints'] = 'schedule_versions' in tables and not report['invalid_version_ids'] and not report['active_overlap_pairs']
        report['approved_to_run_all_pending_migrations'] = False
        report['reason'] = 'Backup/restore and legacy note preservation must be reviewed before alembic upgrade head.'
        await conn.rollback()
    print(json.dumps(report,ensure_ascii=False,indent=2))
    if len(sys.argv)>1:
        Path(sys.argv[1]).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    await engine.dispose()
    return 0 if report['ready_for_version_constraints'] else 2

if __name__ == '__main__':
    try:
        code=asyncio.run(main())
    except Exception as exc:
        # Do not print connection strings, full exception text or private content.
        print(json.dumps({'mode':'read_only','status':'failed','error_type':type(exc).__name__}))
        code=1
    raise SystemExit(code)
