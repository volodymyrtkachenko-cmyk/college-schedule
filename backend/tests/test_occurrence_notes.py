from datetime import date
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app
from app.database import Base, get_db
from app.core.security import get_current_user
from app.models import User, Group, Subject, Schedule, ImportedScheduleChange, LessonOccurrenceNote, LessonNoteRevision

@pytest.fixture
def anyio_backend(): return "asyncio"

@pytest.fixture
async def notes_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    @event.listens_for(engine.sync_engine, "connect")
    def fk(conn, _): conn.execute("PRAGMA foreign_keys=ON")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    async with sessions() as db:
        admin = User(username="admin", name="Admin", role="admin", password_hash="test")
        editor = User(username="editor", name="Editor", role="editor", password_hash="test")
        viewer = User(username="viewer", name="Viewer", role="viewer", password_hash="test")
        a, b = Group(name="A"), Group(name="B")
        x, y = Subject(name="X"), Subject(name="Y")
        editor.allowed_groups = [a]
        db.add_all([admin, editor, viewer, a, b, x, y]); await db.flush()
        lesson = Schedule(group_id=a.id, subject_id=x.id, day_of_week=1, lesson_number=1, week_type="both", is_active=True)
        db.add(lesson); await db.commit()
        state = {"user": admin, "admin": admin, "editor": editor, "viewer": viewer,
                 "a": a.id, "b": b.id, "x": x.id, "y": y.id, "lesson": lesson.id, "sessions": sessions}
    async def override_db():
        async with sessions() as db: yield db
    async def override_user(): return state["user"]
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, state
    finally:
        app.dependency_overrides.clear(); await engine.dispose()


def path(s, d="2026-10-05", n=1, g=None):
    return f"/api/lesson-notes/{g or s['a']}/{d}/{n}"

async def save(c, s, text="First", rev=0, **kw):
    return await c.put(path(s, **kw), json={"subject_id": s["x"], "note": text, "expected_revision": rev})

@pytest.mark.anyio
async def test_create_trim_display_and_date_isolation(notes_client):
    c,s = notes_client
    response = await save(c,s,"  First  ")
    assert response.status_code == 200, response.text
    assert response.json()["note"] == "First"
    assert response.json()["revision"] == 1
    day = (await c.get(f"/api/schedule?group_id={s['a']}&target_date=2026-10-05")).json()
    assert day["lessons"][0]["note"] == "First"
    assert day["lessons"][0]["note_revision"] == 1
    other = (await c.get(f"/api/schedule?group_id={s['a']}&target_date=2026-10-12")).json()
    assert other["lessons"][0]["note"] is None
    week = (await c.get(f"/api/schedule/week?group_id={s['a']}&target_date=2026-10-05")).json()
    assert week[0]["lessons"][0]["note"] == "First"

@pytest.mark.anyio
async def test_revision_conflict_preserves_text_and_history(notes_client):
    c,s = notes_client
    assert (await save(c,s)).status_code == 200
    assert (await save(c,s,"Second",1)).status_code == 200
    stale = await save(c,s,"Lost",1)
    assert stale.status_code == 409
    history = (await c.get(path(s)+"/history")).json()
    assert [row["snapshot"]["note"] for row in history] == ["Second", "First"]
    assert len(history) == 2

@pytest.mark.anyio
@pytest.mark.parametrize("text", ["   ", "x"*10001])
async def test_blank_long_rejected(notes_client,text):
    c,s=notes_client
    assert (await save(c,s,text)).status_code == 422

@pytest.mark.anyio
@pytest.mark.parametrize("slot", [0,5])
async def test_invalid_slot_rejected(notes_client,slot):
    c,s=notes_client
    assert (await save(c,s,n=slot)).status_code == 422

@pytest.mark.anyio
async def test_wrong_date_slot_subject_are_not_accepted(notes_client):
    c,s=notes_client
    assert (await save(c,s,d="2026-10-06")).status_code == 409
    assert (await save(c,s,d="2026-10-10")).status_code == 422
    response = await c.put(path(s), json={"subject_id":s['y'],"note":"wrong","expected_revision":0})
    assert response.status_code == 409

@pytest.mark.anyio
async def test_editor_scope_and_viewer_denial(notes_client):
    c,s=notes_client
    s['user']=s['editor']
    assert (await save(c,s)).status_code == 200
    assert (await save(c,s,g=s['b'])).status_code == 403
    assert (await c.get(path(s,g=s['b'])+'/history')).status_code == 403
    s['user']=s['viewer']
    assert (await save(c,s,"no",1)).status_code == 403
    assert (await c.get(path(s)+'/history')).status_code == 403

@pytest.mark.anyio
async def test_anonymous_writes_and_history_are_unauthorized(notes_client):
    c,s=notes_client
    del app.dependency_overrides[get_current_user]
    assert (await save(c,s)).status_code == 401
    assert (await c.get(path(s)+'/history')).status_code == 401

@pytest.mark.anyio
async def test_delete_archives_and_recreate_retains_both_histories(notes_client):
    c,s=notes_client
    first=(await save(c,s)).json()
    assert (await c.delete(path(s)+f"?subject_id={s['x']}&expected_revision=2")).status_code == 409
    assert (await c.delete(path(s)+f"?subject_id={s['x']}&expected_revision=1")).status_code == 204
    new=(await save(c,s,"New")).json()
    assert new['id'] != first['id']
    history=(await c.get(path(s)+'/history')).json()
    assert {h['event'] for h in history} == {'created','deleted'}
    assert len(history)==3

@pytest.mark.anyio
async def test_subject_patch_archives_without_leaking_to_new_subject(notes_client):
    c,s=notes_client
    assert (await save(c,s)).status_code == 200
    response=await c.patch(f"/api/schedule/{s['lesson']}",json={'subject_id':s['y']})
    assert response.status_code==200,response.text
    items=(await c.get(f"/api/schedule?group_id={s['a']}&target_date=2026-10-05")).json()['lessons']
    assert items[0]['note'] is None
    history=(await c.get(path(s)+'/history')).json()
    assert history[0]['event']=='subject_changed'
    assert history[0]['snapshot']['note']=='First'
    assert history[0]['snapshot']['archived'] is True

@pytest.mark.anyio
async def test_recurring_move_is_atomic_and_moves_only_original_week_occurrence(notes_client):
    c,s=notes_client
    assert (await save(c,s)).status_code==200
    response=await c.patch(f"/api/schedule/{s['lesson']}",json={'day_of_week':2,'lesson_number':2})
    assert response.status_code==200,response.text
    items=(await c.get(f"/api/schedule?group_id={s['a']}&target_date=2026-10-06")).json()['lessons']
    assert items[0]['note']=='First'
    assert items[0]['lesson_number']==2
    history=(await c.get(path(s,d='2026-10-06',n=2)+'/history')).json()
    assert history[0]['event']=='moved'
    assert len(history)==2

@pytest.mark.anyio
async def test_occupied_note_destination_rolls_back_lesson_and_source_note(notes_client):
    c,s=notes_client
    await save(c,s)
    async with s['sessions']() as db:
        db.add(LessonOccurrenceNote(group_id=s['a'],note_date=date(2026,10,6),lesson_number=2,
            subject_id=s['x'],subject_name='X',note='Destination',revision=1,archived=False,origin_kind='schedule',origin_id=999))
        await db.commit()
    response=await c.patch(f"/api/schedule/{s['lesson']}",json={'day_of_week':2,'lesson_number':2})
    assert response.status_code==409,response.text
    async with s['sessions']() as db:
        lesson=await db.get(Schedule,s['lesson'])
        assert (lesson.day_of_week,lesson.lesson_number)==(1,1)
        notes=(await db.scalars(select(LessonOccurrenceNote).where(LessonOccurrenceNote.archived.is_(False)))).all()
        assert {(n.note_date,n.lesson_number,n.note) for n in notes}=={(date(2026,10,5),1,'First'),(date(2026,10,6),2,'Destination')}

@pytest.mark.anyio
async def test_template_delete_archives_text(notes_client):
    c,s=notes_client
    await save(c,s)
    response=await c.delete(f"/api/schedule/{s['lesson']}")
    assert response.status_code==204,response.text
    history=(await c.get(path(s)+'/history')).json()
    assert history[0]['event']=='lesson_deleted'
    assert history[0]['snapshot']['note']=='First'

@pytest.mark.anyio
async def test_imported_substitution_uses_same_stable_key_and_preserves_old_subject(notes_client):
    c,s=notes_client
    await save(c,s)
    async with s['sessions']() as db:
        db.add(ImportedScheduleChange(date=date(2026,10,5),kind='substitution',group_id=s['a'],subject_id=s['y'],
            lesson_number=1,is_published=True,version=1))
        await db.commit()
    items=(await c.get(f"/api/schedule?group_id={s['a']}&target_date=2026-10-05")).json()['lessons']
    assert items[0]['note'] is None
    response=await c.put(path(s),json={'subject_id':s['y'],'note':'Replacement','expected_revision':0})
    assert response.status_code==200,response.text
    history=(await c.get(path(s)+'/history')).json()
    assert {h['snapshot']['note'] for h in history}=={'First','Replacement'}
    async with s['sessions']() as db:
        active=(await db.scalars(select(LessonOccurrenceNote).where(LessonOccurrenceNote.archived.is_(False)))).all()
        assert len(active)==1 and active[0].origin_kind=='imported'


@pytest.mark.anyio
@pytest.mark.parametrize("method", ["PUT", "DELETE"])
async def test_denied_note_write_never_acquires_shared_lock(notes_client, monkeypatch, method):
    import importlib
    router = importlib.import_module("app.routers.lesson_notes")
    calls = []
    async def unexpected_lock(db):
        calls.append("lock")
        raise AssertionError("Denied request acquired the shared writer lock")
    monkeypatch.setattr(router, "lock_versions", unexpected_lock)
    client, state = notes_client
    state["user"] = state["editor"]
    url = path(state, g=state["b"])
    if method == "PUT":
        response = await client.put(url, json={"subject_id": state["x"], "note": "Denied", "expected_revision": 0})
    else:
        response = await client.delete(url, params={"subject_id": state["x"], "expected_revision": 1})
    assert response.status_code == 403, response.text
    assert calls == []
