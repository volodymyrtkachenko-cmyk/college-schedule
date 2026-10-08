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
