from datetime import date
import json
import pytest
from sqlalchemy import select,func,event
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.database import Base
from app.models import Group,Subject,Teacher,Schedule,ScheduleOverride
from app.services.duplicate_repair import create_plan,apply_reviewed_plan,RepairRefused

@pytest.fixture
def anyio_backend():return 'asyncio'

@pytest.fixture
async def db_fixture():
    engine=create_async_engine('sqlite+aiosqlite:///:memory:')
    @event.listens_for(engine.sync_engine,'connect')
    def fk(c,_):
        cur=c.cursor();cur.execute('PRAGMA foreign_keys=ON');cur.close()
    async with engine.begin() as conn:await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine,expire_on_commit=False)() as db:
        g=Group(name='Test group');s=Subject(name='Test subject');t=Teacher(name='Test teacher')
        db.add_all([g,s,t]);await db.flush()
        rows=[Schedule(group_id=g.id,subject_id=s.id,teacher_id=t.id,day_of_week=2,lesson_number=4,week_type='denominator',room_override='212') for _ in range(33)]
        db.add_all(rows);await db.commit();ids=[r.id for r in rows]
    yield engine,ids
    await engine.dispose()

@pytest.mark.anyio
async def test_dry_plan_does_not_write_and_json_roundtrip(db_fixture):
    engine,ids=db_fixture
    async with engine.connect() as conn:
        plan=await create_plan(conn)
        assert json.loads(json.dumps(plan))==plan
        assert plan['active_before']==33 and plan['deactivate_count']==32
        assert plan['actions'][0]['keep_id']==min(ids)
        assert await conn.scalar(select(func.count()).select_from(Schedule).where(Schedule.is_active.is_(True)))==33

@pytest.mark.anyio
async def test_apply_soft_deactivates_and_keeps_all_physical_rows(db_fixture):
    engine,ids=db_fixture
    async with engine.connect() as conn:plan=await create_plan(conn)
    async with engine.begin() as conn:receipt=await apply_reviewed_plan(conn,plan,allow_sqlite_test=True)
    assert receipt['physical_deletions']==0 and receipt['deactivated_count']==32
    async with engine.connect() as conn:
        assert await conn.scalar(select(func.count()).select_from(Schedule))==33
        assert await conn.scalar(select(func.count()).select_from(Schedule).where(Schedule.is_active.is_(True)))==1
        assert (await conn.scalar(select(Schedule.id).where(Schedule.is_active.is_(True))))==min(ids)

@pytest.mark.anyio
async def test_stale_plan_rejected_without_changes(db_fixture):
    engine,ids=db_fixture
    async with engine.connect() as conn:plan=await create_plan(conn)
    async with engine.begin() as conn:await conn.exec_driver_sql('UPDATE schedule SET room_override=\'213\'')
    with pytest.raises(RepairRefused,match='stale_or_modified_plan'):
        async with engine.begin() as conn:await apply_reviewed_plan(conn,plan,allow_sqlite_test=True)
    async with engine.connect() as conn:
        assert await conn.scalar(select(func.count()).select_from(Schedule).where(Schedule.is_active.is_(True)))==33

@pytest.mark.anyio
async def test_references_block_repair_without_deleting_override(db_fixture):
    engine,ids=db_fixture
    async with async_sessionmaker(engine)() as db:
        db.add(ScheduleOverride(schedule_id=ids[-1],date=date(2026,10,20),room='Manual',cancelled=False));await db.commit()
    with pytest.raises(RepairRefused,match='references_requires_manual_mapping'):
        async with engine.connect() as conn:await create_plan(conn)
    async with engine.connect() as conn:
        assert await conn.scalar(select(func.count()).select_from(ScheduleOverride))==1

@pytest.mark.anyio
async def test_transaction_error_rolls_back_all_deactivations(db_fixture):
    engine,_=db_fixture
    async with engine.connect() as conn:plan=await create_plan(conn)
    with pytest.raises(RuntimeError,match='simulated'):
        async with engine.begin() as conn:
            await apply_reviewed_plan(conn,plan,allow_sqlite_test=True)
            raise RuntimeError('simulated failure before commit')
    async with engine.connect() as conn:
        assert await conn.scalar(select(func.count()).select_from(Schedule).where(Schedule.is_active.is_(True)))==33

@pytest.mark.anyio
async def test_modified_plan_rejected(db_fixture):
    engine,_=db_fixture
    async with engine.connect() as conn:plan=await create_plan(conn)
    plan['actions'][0]['deactivate_ids']=[]
    with pytest.raises(RepairRefused,match='stale_or_modified_plan'):
        async with engine.begin() as conn:await apply_reviewed_plan(conn,plan,allow_sqlite_test=True)

@pytest.mark.anyio
async def test_second_apply_is_refused(db_fixture):
    engine,_=db_fixture
    async with engine.connect() as conn:plan=await create_plan(conn)
    async with engine.begin() as conn:await apply_reviewed_plan(conn,plan,allow_sqlite_test=True)
    with pytest.raises(RepairRefused,match='stale_or_modified_plan'):
        async with engine.begin() as conn:await apply_reviewed_plan(conn,plan,allow_sqlite_test=True)

@pytest.mark.anyio
async def test_sqlite_apply_forbidden_outside_explicit_unit_test(db_fixture):
    engine,_=db_fixture
    async with engine.connect() as conn:plan=await create_plan(conn)
    with pytest.raises(RepairRefused,match='apply_requires_postgresql'):
        async with engine.begin() as conn:await apply_reviewed_plan(conn,plan)

async def add_existing_both(engine,ids,changes=None):
    async with async_sessionmaker(engine,expire_on_commit=False)() as db:
        first=await db.get(Schedule,ids[0])
        values={column.name:getattr(first,column.name) for column in Schedule.__table__.columns if column.name!='id'}
        values.update(week_type='both');values.update(changes or {})
        row=Schedule(**values);db.add(row);await db.commit();return row.id

@pytest.mark.anyio
async def test_default_still_refuses_covered_week_case(db_fixture):
    engine,ids=db_fixture;await add_existing_both(engine,ids)
    with pytest.raises(RepairRefused,match='non_exact_week_overlap_requires_review'):
        async with engine.connect() as conn:await create_plan(conn)

@pytest.mark.anyio
async def test_opted_in_plan_keeps_existing_both_even_when_id_is_larger(db_fixture):
    engine,ids=db_fixture;both_id=await add_existing_both(engine,ids)
    async with engine.connect() as conn:plan=await create_plan(conn,allow_covered_week_duplicates=True)
    assert plan['actions'][0]['keep_id']==both_id
    assert plan['actions'][0]['deactivate_ids']==ids
    assert plan['actions'][0]['reason']=='covered_by_existing_both'
    assert plan['actions'][0]['coverage_before']==plan['actions'][0]['coverage_after']==['denominator','numerator']

@pytest.mark.anyio
async def test_covered_week_apply_preserves_both_weeks_and_all_rows(db_fixture):
    from app.services.schedule import fetch_schedule
    engine,ids=db_fixture;both_id=await add_existing_both(engine,ids)
    async with engine.connect() as conn:plan=await create_plan(conn,allow_covered_week_duplicates=True)
    async with engine.begin() as conn:receipt=await apply_reviewed_plan(conn,plan,allow_sqlite_test=True)
    assert receipt['deactivated_count']==33
    async with async_sessionmaker(engine,expire_on_commit=False)() as db:
        row=await db.get(Schedule,both_id)
        assert row.is_active and row.week_type=='both'
        assert await db.scalar(select(func.count()).select_from(Schedule))==34
        for target in (date(2026,10,20),date(2026,10,27)):
            _,lessons=await fetch_schedule(db,target,group_id=row.group_id,semester_start=date(2026,10,12),periods=[])
            assert [lesson.id for lesson in lessons]==[both_id]

@pytest.mark.anyio
@pytest.mark.parametrize('changes',[{'room_override':'213'},{'stream_id':'different'},{'second_teacher_id':1},{'is_replacement':True}])
async def test_opt_in_does_not_ignore_other_assignment_fields(db_fixture,changes):
    engine,ids=db_fixture;await add_existing_both(engine,ids,changes)
    with pytest.raises(RepairRefused,match='overlapping_assignment_conflict'):
        async with engine.connect() as conn:await create_plan(conn,allow_covered_week_duplicates=True)

@pytest.mark.anyio
async def test_covered_group_reference_still_blocks_plan(db_fixture):
    engine,ids=db_fixture;await add_existing_both(engine,ids)
    async with async_sessionmaker(engine)() as db:
        db.add(ScheduleOverride(schedule_id=ids[-1],date=date(2026,10,20),cancelled=True));await db.commit()
    with pytest.raises(RepairRefused,match='references_requires_manual_mapping'):
        async with engine.connect() as conn:await create_plan(conn,allow_covered_week_duplicates=True)

@pytest.mark.anyio
async def test_separate_numerator_and_denominator_never_synthesizes_both(db_fixture):
    engine,ids=db_fixture
    async with async_sessionmaker(engine,expire_on_commit=False)() as db:
        first=await db.get(Schedule,ids[0])
        values={column.name:getattr(first,column.name) for column in Schedule.__table__.columns if column.name!='id'}
        values['week_type']='numerator';db.add(Schedule(**values));await db.commit()
    async with engine.connect() as conn:plan=await create_plan(conn,allow_covered_week_duplicates=True)
    async with engine.begin() as conn:await apply_reviewed_plan(conn,plan,allow_sqlite_test=True)
    async with engine.connect() as conn:
        weeks=list((await conn.scalars(select(Schedule.week_type).where(Schedule.is_active.is_(True)))).all())
        assert sorted(weeks)==['denominator','numerator']
