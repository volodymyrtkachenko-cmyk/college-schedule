import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app
from app.database import Base, get_db
from app.core.security import get_current_user
from app.models import User, ScheduleVersion

@pytest.fixture
def anyio_backend(): return 'asyncio'

@pytest.fixture
async def client_and_sessions():
    engine=create_async_engine('sqlite+aiosqlite:///:memory:')
    @event.listens_for(engine.sync_engine, 'connect')
    def enable_foreign_keys(connection, _):
        cursor=connection.cursor();cursor.execute('PRAGMA foreign_keys=ON');cursor.close()
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async def db_override():
        async with sessions() as db: yield db
    async def user_override():
        return User(id=123,username='test',name='Test',role='admin',is_active=True)
    app.dependency_overrides[get_db]=db_override
    app.dependency_overrides[get_current_user]=user_override
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
            yield client,sessions
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()

BASE={'name':'  Test  ','valid_from':'2026-10-01','valid_until':'2026-10-10'}

@pytest.mark.anyio
async def test_create_trims_name(client_and_sessions):
    client,_=client_and_sessions
    response=await client.post('/api/schedule-versions',json=BASE)
    assert response.status_code==201
    assert response.json()['name']=='Test'

@pytest.mark.anyio
@pytest.mark.parametrize('payload',[
    {**BASE,'name':'   '},{**BASE,'name':'x'*256},
    {**BASE,'valid_from':'2026-10-11'},{**BASE,'name':None},
])
async def test_invalid_create_is_422(client_and_sessions,payload):
    client,sessions=client_and_sessions
    assert (await client.post('/api/schedule-versions',json=payload)).status_code==422
    async with sessions() as db:
        assert not list((await db.scalars(select(ScheduleVersion))).all())

@pytest.mark.anyio
@pytest.mark.parametrize('field',['name','valid_from','valid_until','is_active'])
async def test_patch_null_rejected(client_and_sessions,field):
    client,_=client_and_sessions
    item=(await client.post('/api/schedule-versions',json=BASE)).json()
    response=await client.patch(f"/api/schedule-versions/{item['id']}",json={field:None})
    assert response.status_code==422

@pytest.mark.anyio
async def test_patch_checks_result_and_preserves_old_data(client_and_sessions):
    client,sessions=client_and_sessions
    item=(await client.post('/api/schedule-versions',json=BASE)).json()
    response=await client.patch(f"/api/schedule-versions/{item['id']}",json={'valid_from':'2026-10-11'})
    assert response.status_code==422
    async with sessions() as db:
        row=await db.get(ScheduleVersion,item['id'])
        assert row.valid_from.isoformat()=='2026-10-01'

@pytest.mark.anyio
async def test_inclusive_overlap_rejected_but_inactive_allowed(client_and_sessions):
    client,_=client_and_sessions
    assert (await client.post('/api/schedule-versions',json=BASE)).status_code==201
    other={**BASE,'valid_from':'2026-10-10','valid_until':'2026-10-20'}
    assert (await client.post('/api/schedule-versions',json=other)).status_code==409
    assert (await client.post('/api/schedule-versions',json={**other,'is_active':False})).status_code==201
    assert (await client.post('/api/schedule-versions',json={**other,'valid_from':'2026-10-11'})).status_code==201

@pytest.mark.anyio
async def test_clone_self_and_unknown_source_rejected(client_and_sessions):
    client,_=client_and_sessions
    item=(await client.post('/api/schedule-versions',json={**BASE,'is_active':False})).json();id=item['id']
    assert (await client.post(f'/api/schedule-versions/{id}/clone-from/{id}')).status_code==409
    assert (await client.post(f'/api/schedule-versions/{id}/clone-from/9999')).status_code==404
    assert (await client.post(f'/api/schedule-versions/{id}/clone-from/0')).status_code==409

@pytest.mark.anyio
async def test_active_delete_blocked(client_and_sessions):
    client,_=client_and_sessions
    item=(await client.post('/api/schedule-versions',json=BASE)).json()
    assert (await client.delete(f"/api/schedule-versions/{item['id']}")).status_code==409

@pytest.mark.anyio
async def test_empty_inactive_delete_allowed(client_and_sessions):
    client,_=client_and_sessions
    item=(await client.post('/api/schedule-versions',json={**BASE,'is_active':False})).json()
    assert (await client.delete(f"/api/schedule-versions/{item['id']}")).status_code==204

@pytest.mark.anyio
async def test_clone_and_delete_do_not_erase_target_or_overrides(client_and_sessions):
    from datetime import date
    from app.models import Group,Subject,Schedule,ScheduleOverride
    client,sessions=client_and_sessions
    target=(await client.post('/api/schedule-versions',json={**BASE,'is_active':False})).json()
    source=(await client.post('/api/schedule-versions',json={**BASE,'is_active':False,'name':'Source'})).json()
    async with sessions() as db:
        group=Group(name='Test group');subject=Subject(name='Test subject')
        db.add_all([group,subject]);await db.flush()
        row=Schedule(group_id=group.id,subject_id=subject.id,day_of_week=1,lesson_number=1,week_type='both',version_id=target['id'])
        db.add(row);await db.flush()
        override=ScheduleOverride(schedule_id=row.id,group_id=1,lesson_number=2,date=date(2026,10,5),room='Manual',cancelled=False)
        db.add(override);await db.commit();row_id=row.id;override_id=override.id
    assert (await client.post(f"/api/schedule-versions/{target['id']}/clone-from/{source['id']}")).status_code==409
    assert (await client.delete(f"/api/schedule-versions/{target['id']}")).status_code==409
    async with sessions() as db:
        assert await db.get(Schedule,row_id) is not None
        assert (await db.get(ScheduleOverride,override_id)).room=='Manual'

@pytest.mark.anyio
async def test_clone_into_empty_target_copies_without_deleting_source(client_and_sessions):
    from app.models import Group,Subject,Schedule
    client,sessions=client_and_sessions
    target=(await client.post('/api/schedule-versions',json={**BASE,'is_active':False})).json()
    source=(await client.post('/api/schedule-versions',json={**BASE,'is_active':False,'name':'Source'})).json()
    async with sessions() as db:
        group=Group(name='Test group');subject=Subject(name='Test subject')
        db.add_all([group,subject]);await db.flush()
        row=Schedule(group_id=group.id,subject_id=subject.id,day_of_week=1,lesson_number=1,week_type='both',version_id=source['id'])
        db.add(row);await db.commit();source_id=row.id
    response=await client.post(f"/api/schedule-versions/{target['id']}/clone-from/{source['id']}")
    assert response.status_code==200
    assert response.json()['count']==1
    async with sessions() as db:
        assert await db.get(Schedule,source_id) is not None
        targets=list((await db.scalars(select(Schedule).where(Schedule.version_id==target['id']))).all())
        assert len(targets)==1
        assert targets[0].id!=source_id
