"""Default: read-only plan. --apply requires explicit reviewed hash and backup acknowledgement."""
import argparse,asyncio,json
from pathlib import Path
from app.database import engine
from app.services.duplicate_repair import create_plan,apply_reviewed_plan,RepairRefused

async def run(args):
    try:
        if engine.dialect.name=='sqlite':
            path=engine.url.database
            if not path or path==':memory:' or not Path(path).is_file():raise RepairRefused('existing_database_required')
        if args.apply:
            if not args.plan or not args.approve_plan_hash or not args.backup_confirmed:
                raise RepairRefused('apply_requires_reviewed_plan_hash_and_backup_confirmation')
            if Path(args.plan).resolve()==Path(args.output).resolve():raise RepairRefused('receipt_must_not_overwrite_reviewed_plan')
            reviewed=json.loads(Path(args.plan).read_text())
            reviewed={k:v for k,v in reviewed.items() if k not in ('status','approved_to_apply')}
            if args.approve_plan_hash!=reviewed.get('plan_hash'):raise RepairRefused('approved_hash_mismatch')
            async with engine.begin() as conn:
                if args.expected_active_count is not None or args.expected_set_count is not None:
                    fresh=await create_plan(conn)
                    if args.expected_active_count is not None and fresh['active_before']!=args.expected_active_count:raise RepairRefused('unexpected_active_count')
                    if args.expected_set_count is not None and fresh['duplicate_set_count']!=args.expected_set_count:raise RepairRefused('unexpected_duplicate_set_count')
                result=await apply_reviewed_plan(conn,reviewed)
            # Receipt written only after successful commit. If this write fails, verify live state before retrying.
            result['backup_acknowledged']=True
            code=0
        else:
            async with engine.connect() as conn:
                if conn.dialect.name=='postgresql':await conn.exec_driver_sql('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                elif conn.dialect.name=='sqlite':await conn.exec_driver_sql('PRAGMA query_only=ON')
                else:raise RepairRefused('unsupported_dialect')
                result=await create_plan(conn)
                if args.expected_active_count is not None and result['active_before']!=args.expected_active_count:raise RepairRefused('unexpected_active_count')
                if args.expected_set_count is not None and result['duplicate_set_count']!=args.expected_set_count:raise RepairRefused('unexpected_duplicate_set_count')
                await conn.rollback()
            result={'status':'plan_only',**result,'approved_to_apply':False}
            # Service compares the core reviewed plan, without presentation-only fields.
            code=0
        Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({k:v for k,v in result.items() if k not in ('actions','deactivated_ids','kept_ids')},ensure_ascii=False))
    except Exception as exc:
        result={'status':'refused_or_failed','code':str(exc) if isinstance(exc,RepairRefused) else type(exc).__name__,
                'approved_to_apply':False}
        # Never print arbitrary driver exception text/DSN/password.
        if not args.plan or Path(args.plan).resolve()!=Path(args.output).resolve():
            Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(result));code=1
    finally:
        await engine.dispose()
    return code

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--plan')
    parser.add_argument('--approve-plan-hash')
    parser.add_argument('--backup-confirmed',action='store_true')
    parser.add_argument('--expected-active-count',type=int)
    parser.add_argument('--expected-set-count',type=int)
    args=parser.parse_args()
    raise SystemExit(asyncio.run(run(args)))

if __name__=='__main__':main()
