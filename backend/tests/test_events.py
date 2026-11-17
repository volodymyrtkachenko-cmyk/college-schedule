from datetime import date
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import Group, Faculty, Subject, Teacher, User


@pytest.fixture
async def events_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        faculty = Faculty(name="Факультет")
        session.add(faculty)
        await session.flush()

        group = Group(name="99-1", faculty_id=faculty.id)
        subject = Subject(name="Математика")
        teacher = Teacher(name="Іванов І.І.", room="101")
        admin = User(username="admin", name="Admin", role="admin", password_hash=hash_password("pass"))
        session.add_all([group, subject, teacher, admin])
        await session.commit()
        token = create_access_token(admin)
        data = {
            "group_id": group.id,
            "subject_id": subject.id,
            "teacher_id": teacher.id,
            "token": token,
        }

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, data
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_academic_events_crud(events_client):
    client, data = events_client
    headers = {"Authorization": f"Bearer {data['token']}"}

    # 1. Create event
    payload = {
        "group_id": data["group_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "event_type": "exam",
        "event_date": "2026-06-15",
        "start_time": "09:00",
        "room": "303",
        "note": "Принести заліковку",
    }
    create_resp = await client.post("/api/events", json=payload, headers=headers)
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["title"] == "Математика"
    assert created["event_type"] == "exam"
    event_id = created["id"]

    # 2. List events
    list_resp = await client.get(f"/api/events?group_id={data['group_id']}")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 1
    assert items[0]["id"] == event_id

    # 3. Delete event
    del_resp = await client.delete(f"/api/events/{event_id}", headers=headers)
    assert del_resp.status_code == 200

    # 4. List again is empty
    list_resp2 = await client.get(f"/api/events?group_id={data['group_id']}")
    assert list_resp2.status_code == 200
    assert len(list_resp2.json()) == 0


@pytest.mark.anyio
async def test_academic_event_replaces_other_teachers_slot_in_day_and_week_projection():
    from datetime import time
    from app.models import BellSchedule, Schedule

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with sessions() as session:
        faculty = Faculty(name="Факультет")
        session.add(faculty)
        await session.flush()

        group = Group(name="99-2", faculty_id=faculty.id, is_active=True)
        subj_base = Subject(name="Вища математика")
        subj_exam = Subject(name="Фізика")
        teacher_base = Teacher(name="Авраменко А.А.", room="101", is_active=True)
        teacher_exam = Teacher(name="Бойко Б.Б.", room="202", is_active=True)
        admin = User(username="admin_ev", name="Admin", role="admin", password_hash=hash_password("pass"))
        bell = BellSchedule(lesson_number=1, start_time=time(9, 0), end_time=time(10, 20), is_active=True)
        session.add_all([group, subj_base, subj_exam, teacher_base, teacher_exam, admin, bell])
        await session.flush()

        sched = Schedule(
            group_id=group.id,
            subject_id=subj_base.id,
            teacher_id=teacher_base.id,
            day_of_week=1,
            lesson_number=1,
            week_type="both",
            is_active=True,
        )
        session.add(sched)
        await session.commit()

        ids = {
            "group_id": group.id,
            "subj_exam_id": subj_exam.id,
            "teacher_base_id": teacher_base.id,
            "teacher_exam_id": teacher_exam.id,
            "token": create_access_token(admin),
        }

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = {"Authorization": f"Bearer {ids['token']}"}
            ev_resp = await client.post(
                "/api/events",
                json={
                    "group_id": ids["group_id"],
                    "subject_id": ids["subj_exam_id"],
                    "teacher_id": ids["teacher_exam_id"],
                    "event_type": "exam",
                    "event_date": "2026-06-15",  # Monday (day_of_week == 1)
                    "lesson_number": 1,
                    "start_time": "09:00",
                    "room": "202",
                    "title": "Екзамен з фізики",
                },
                headers=headers,
            )
            assert ev_resp.status_code == 201

            # Group schedule sees exam instead of base lesson
            grp_day = await client.get(f"/api/schedule?group_id={ids['group_id']}&target_date=2026-06-15")
            assert grp_day.status_code == 200
            grp_lessons = grp_day.json()["lessons"]
            assert len(grp_lessons) == 1
            assert grp_lessons[0]["event_type"] == "exam"
            assert grp_lessons[0]["teacher_id"] == ids["teacher_exam_id"]

            # Displaced teacher must NOT see a phantom base lesson on day OR week projection
            t_day = await client.get(f"/api/schedule?teacher_id={ids['teacher_base_id']}&target_date=2026-06-15")
            assert t_day.status_code == 200
            assert t_day.json()["lessons"] == []

            t_week = await client.get(f"/api/schedule/week?teacher_id={ids['teacher_base_id']}&target_date=2026-06-15")
            assert t_week.status_code == 200
            mon_entry = next(d for d in t_week.json() if d["date"] == "2026-06-15")
            assert mon_entry["lessons"] == []

            # Event teacher sees the exam in week projection
            ex_week = await client.get(f"/api/schedule/week?teacher_id={ids['teacher_exam_id']}&target_date=2026-06-15")
            assert ex_week.status_code == 200
            ex_mon = next(d for d in ex_week.json() if d["date"] == "2026-06-15")
            assert len(ex_mon["lessons"]) == 1
            assert ex_mon["lessons"][0]["event_type"] == "exam"
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()
