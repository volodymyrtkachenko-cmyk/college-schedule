from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import pytest
from fastapi import HTTPException
from sqlalchemy import select,func,event,text
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.database import Base
from app.models import Group,Subject,Teacher,Schedule,ScheduleDraft,ScheduleSlot,Curriculum,ScheduleVersion,ImportedScheduleChange
from app.routers import admin_import,drafts
from app.services.schedule import fetch_schedule
from app.services.import_slot_safety import normalize_base_slots,version_for_import,guard_protected_replacement

@pytest.fixture
def anyio_backend(): return 'asyncio'

@pytest.fixture
async def context():
    engine=create_async_engine('sqlite+aiosqlite:///:memory:')
    @event.listens_for(engine.sync_engine,'connect')
    def fk(connection,_):
        cursor=connection.cursor();cursor.execute('PRAGMA foreign_keys=ON');cursor.close()
    async with engine.begin() as c: await c.run_sync(Base.metadata.create_all)
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    async with sessions() as db:
        g=Group(name='Test group');s=Subject(name='Test subject');t=Teacher(name='Test teacher')
        db.add_all([g,s,t]);await db.commit()
        yield db,dict(group_id=g.id,subject_id=s.id,teacher_id=t.id)
    await engine.dispose()

BASE=dict(group_id=1,subject_id=1,teacher_id=1,second_teacher_id=None,day_of_week=2,lesson_number=4,room='212',week_type='denominator')

def test_twenty_exact_repeats_become_one():
    assert normalize_base_slots([BASE]*20)==[BASE]

def test_same_assignment_merges_opposite_weeks():
    assert normalize_base_slots([BASE,{**BASE,'week_type':'numerator'}])[0]['week_type']=='both'

def test_different_assignments_allowed_on_nonoverlapping_weeks():
    assert len(normalize_base_slots([BASE,{**BASE,'subject_id':2,'week_type':'numerator'}]))==2

@pytest.mark.parametrize('change',[{'subject_id':2},{'teacher_id':2},{'second_teacher_id':2},{'room':'213'},{'stream_id':'different'}])
def test_different_overlapping_assignment_rejected(change):
    with pytest.raises(HTTPException) as exc: normalize_base_slots([BASE,{**BASE,**change}])
    assert exc.value.status_code==409
    assert exc.value.detail['code']=='import_cell_conflict'

@pytest.mark.parametrize('change',[{'week_type':'bad'},{'lesson_number':5},{'day_of_week':7},{'group_id':0}])
def test_invalid_import_slot_rejected(change):
    with pytest.raises(HTTPException) as exc: normalize_base_slots([{**BASE,**change}])
    assert exc.value.status_code==422

def setup_source(monkeypatch,ids,substitution=False):
    target=date(2026,10,20)
    slot={**BASE,**ids}
    sub={**ids,'date':target.isoformat(),'lesson_number':4,'week_type':'denominator','second_teacher_id':None,'room':'212'}
    monkeypatch.setattr(admin_import.ScheduleFetcher,'get_all_group_ids',AsyncMock(return_value=['test-source']))
    monkeypatch.setattr(admin_import.ScheduleFetcher,'fetch_html',AsyncMock(return_value='<html><body>test fixture</body></html>'))
    monkeypatch.setattr(admin_import.KREParser,'parse',Mock(return_value=SimpleNamespace(week_type='denominator',lessons=[SimpleNamespace(date=target)])))
    monkeypatch.setattr(admin_import.EntityNormalizer,'load_dictionaries',AsyncMock())
    monkeypatch.setattr(admin_import.ScheduleDiffer,'diff',AsyncMock(return_value={
        'unresolved':[],'unresolved_substitutions':[],'substitutions':[sub] if substitution else [],
        'cancelled':[],'base_slots':[] if substitution else [slot],'skipped_base_slots':[],
    }))
    return slot

@pytest.mark.anyio
async def test_new_draft_then_same_pending_runs_full_import_body(context,monkeypatch):
    db,ids=context;setup_source(monkeypatch,ids)
    monkeypatch.setattr(admin_import,'matches_published_schedule',AsyncMock(return_value=False))
    first=await admin_import._do_import(db,2,'new-draft-test')
    second=await admin_import._do_import(db,2,'same-pending-test')
    assert first['meta']['reason']=='draft_created'
    assert second['meta']['reason']=='same_pending_payload'
    assert first['meta']['draft_created']==second['meta']['draft_created']
    assert second['meta']['auto_published'] is False
    assert await db.scalar(select(func.count()).select_from(ScheduleDraft))==1
    assert await db.scalar(select(func.count()).select_from(ScheduleSlot))==1

@pytest.mark.anyio
async def test_unchanged_runs_full_import_body(context,monkeypatch):
    db,ids=context;setup_source(monkeypatch,ids)
    monkeypatch.setattr(admin_import,'matches_published_schedule',AsyncMock(return_value=True))
    result=await admin_import._do_import(db,2,'unchanged-test')
    assert result['meta']['unchanged'] is True
    assert result['meta']['auto_published'] is False
    assert await db.scalar(select(func.count()).select_from(ScheduleDraft))==0

@pytest.mark.anyio
async def test_empty_source_is_not_success(context,monkeypatch):
    db,_=context
    monkeypatch.setattr(admin_import.ScheduleFetcher,'get_all_group_ids',AsyncMock(return_value=[]))
    monkeypatch.setattr(admin_import.EntityNormalizer,'load_dictionaries',AsyncMock())
    with pytest.raises(HTTPException) as exc: await admin_import._do_import(db,2,'empty-source')
    assert exc.value.status_code==502
    assert await db.scalar(select(func.count()).select_from(ScheduleDraft))==0

@pytest.mark.anyio
async def test_restoration_does_not_copy_historical_version(context,monkeypatch):
    db,ids=context;setup_source(monkeypatch,ids,substitution=True)
    old=ScheduleVersion(name='Old',valid_from=date(2025,1,1),valid_until=date(2025,12,31),is_active=False)
    current=ScheduleVersion(name='Current',valid_from=date(2026,10,1),valid_until=date(2026,12,31),is_active=True)
    db.add_all([old,current]);await db.flush()
    db.add_all([Schedule(**ids,day_of_week=2,lesson_number=4,week_type='denominator',version_id=old.id,room_override='999') for _ in range(20)])
    db.add(Schedule(**ids,day_of_week=2,lesson_number=4,week_type='denominator',version_id=current.id,room_override='212'))
    await db.commit()
    monkeypatch.setattr(admin_import,'matches_published_schedule',AsyncMock(return_value=False))
    result=await admin_import._do_import(db,2,'historical-version-test')
    assert len(result['report']['base_slots'])==1
    assert result['report']['base_slots'][0]['room']=='212'
    draft=await db.get(ScheduleDraft,result['meta']['draft_created'])
    assert draft.data['base_version_id']==current.id

@pytest.mark.anyio
async def test_twenty_restored_rows_produce_one_draft_slot(context,monkeypatch):
    db,ids=context;setup_source(monkeypatch,ids,substitution=True)
    db.add_all([Schedule(**ids,day_of_week=2,lesson_number=4,week_type='denominator',room_override='212') for _ in range(20)])
    await db.commit()
    monkeypatch.setattr(admin_import,'matches_published_schedule',AsyncMock(return_value=False))
    result=await admin_import._do_import(db,2,'twenty-rows-test')
    assert len(result['report']['base_slots'])==1
    assert await db.scalar(select(func.count()).select_from(ScheduleSlot))==1
    assert await db.scalar(select(func.count()).select_from(Schedule))==20  # No automatic cleanup.

@pytest.mark.anyio
async def test_duplicate_draft_rejected_before_any_publish_write(context):
    db,ids=context
    curriculum=Curriculum(**ids,pairs_per_2_weeks=2,total_hours=0)
    draft=ScheduleDraft(name='Repeated slots',status='DRAFT')
    existing=Schedule(**ids,day_of_week=2,lesson_number=4,week_type='denominator')
    db.add_all([curriculum,draft,existing]);await db.flush()
    db.add_all([ScheduleSlot(draft_id=draft.id,curriculum_id=curriculum.id,day_of_week=2,lesson_number=4,week_type='denominator') for _ in range(20)])
    await db.commit()
    with pytest.raises(HTTPException) as exc: await drafts.publish_draft(draft.id,db=db,admin=None)
    assert exc.value.status_code==409
    assert exc.value.detail['code']=='draft_duplicate_slots'
    assert draft.status=='DRAFT'
    assert await db.get(Schedule,existing.id) is not None

@pytest.mark.anyio
async def test_repeat_publish_returns_409(context):
    db,_=context;draft=ScheduleDraft(name='Published',status='published');db.add(draft);await db.commit()
    with pytest.raises(HTTPException) as exc: await drafts.publish_draft(draft.id,db=db,admin=None)
    assert exc.value.status_code==409

@pytest.mark.anyio
async def test_import_crossing_versions_rejected(context):
    db,_=context
    db.add(ScheduleVersion(name='A',valid_from=date(2026,10,1),valid_until=date(2026,10,20),is_active=True))
    await db.commit()
    with pytest.raises(HTTPException) as exc: await version_for_import(db,['2026-10-20','2026-10-21'],date(2026,10,20))
    assert exc.value.status_code==409
    assert exc.value.detail['code']=='import_spans_versions'

@pytest.mark.anyio
async def test_legacy_notes_block_destructive_replacement(context):
    db,ids=context;row=Schedule(**ids,day_of_week=2,lesson_number=4,week_type='denominator');db.add(row);await db.flush()
    await db.execute(text('CREATE TABLE lesson_notes(id INTEGER PRIMARY KEY,schedule_id INTEGER,note TEXT)'))
    await db.execute(text('INSERT INTO lesson_notes(id,schedule_id,note) VALUES(1,:id,:note)'),{'id':row.id,'note':'preserve-test-note'})
    await db.commit()
    with pytest.raises(HTTPException) as exc: await guard_protected_replacement(db,[row.id])
    assert exc.value.detail['code']=='lesson_notes_require_mapping'
    assert await db.scalar(text('SELECT note FROM lesson_notes WHERE id=1'))=='preserve-test-note'

@pytest.mark.anyio
async def test_farther_denominators_have_one_pair_after_safe_explicit_publish(context,monkeypatch):
    db,ids=context;setup_source(monkeypatch,ids)
    monkeypatch.setattr(admin_import,'matches_published_schedule',AsyncMock(return_value=False))
    result=await admin_import._do_import(db,2,'calendar-test')
    await drafts.publish_draft(result['meta']['draft_created'],db=db,admin=None)
    for target in (date(2026,10,20),date(2026,11,3),date(2026,11,17)):
        wt,lessons=await fetch_schedule(db,target,group_id=ids['group_id'],semester_start=date(2026,10,12),periods=[])
        assert wt=='denominator'
        assert len(lessons)==1
    _,numerator=await fetch_schedule(db,date(2026,10,27),group_id=ids['group_id'],semester_start=date(2026,10,12),periods=[])
    assert numerator==[]
