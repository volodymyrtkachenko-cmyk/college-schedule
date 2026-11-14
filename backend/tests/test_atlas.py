from datetime import date, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.time import today_local
from app.database import Base, get_db
from app.main import app
from app.models import (
    Faculty,
    Group,
    Schedule,
    ScheduleVersion,
    Subject,
    Teacher,
)
from app.services.directory_cache import invalidate_directory_cache


@pytest.fixture
async def atlas_client():
    invalidate_directory_cache()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, sessions
    app.dependency_overrides.clear()
    invalidate_directory_cache()
    await engine.dispose()


@pytest.mark.anyio
async def test_atlas_aggregates_graph_filters_inactive_and_normalizes_rooms(atlas_client):
    client, sessions = atlas_client
    today = today_local()

    async with sessions() as db:
        fac = Faculty(name="Комп'ютерні науки", short_name="КН", is_active=True)
        db.add(fac)
        await db.flush()

        t1 = Teacher(name="Петренко І.І.", full_name="Петренко Іван Іванович", room="ауд. 312", is_active=True)
        t2 = Teacher(name="Коваленко О.О.", room="204а", is_active=True)
        t_tech = Teacher(name="!Вакансія", room="101", is_active=True)
        t_inactive = Teacher(name="Звільнений А.А.", room="404", is_active=False)
        db.add_all([t1, t2, t_tech, t_inactive])
        await db.flush()

        g1 = Group(name="КІ-24-1", faculty_id=fac.id, curator_id=t1.id, year_of_admission=today.year - 2, is_active=True)
        g2 = Group(name="КІ-24-2", faculty_id=fac.id, is_active=True)
        g_inactive = Group(name="АРХ-19-1", faculty_id=fac.id, is_active=False)
        db.add_all([g1, g2, g_inactive])
        await db.flush()

        s_prog = Subject(name="Програмування", short_name="Прогр.", is_active=True)
        s_eng = Subject(name="Англійська мова", short_name="Англ.", is_active=True)
        s_inactive = Subject(name="Застарілий курс", is_active=False)
        db.add_all([s_prog, s_eng, s_inactive])
        await db.flush()

        active_ver = ScheduleVersion(
            name="Поточний семестр",
            valid_from=today - timedelta(days=10),
            valid_until=today + timedelta(days=30),
            is_active=True,
        )
        old_ver = ScheduleVersion(
            name="Минулий семестр",
            valid_from=today - timedelta(days=120),
            valid_until=today - timedelta(days=20),
            is_active=False,
        )
        db.add_all([active_ver, old_ver])
        await db.flush()

        db.add_all([
            # Same edge twice across Mon & Wed -> aggregated into lessons_count=2, days=[1, 3], room="312" (floor 3)
            Schedule(
                group_id=g1.id, teacher_id=t1.id, subject_id=s_prog.id,
                day_of_week=1, lesson_number=1, week_type="both", is_active=True, version_id=active_ver.id,
            ),
            Schedule(
                group_id=g1.id, teacher_id=t1.id, subject_id=s_prog.id,
                day_of_week=3, lesson_number=2, week_type="both", is_active=True, version_id=active_ver.id,
            ),
            # Dual teacher edge with room_override -> room="204а" (floor 2)
            Schedule(
                group_id=g1.id, teacher_id=t2.id, second_teacher_id=t1.id, subject_id=s_eng.id,
                day_of_week=2, lesson_number=3, week_type="both", room_override="204а",
                is_active=True, version_id=active_ver.id,
            ),
            # Second group taught by t2 in Спортзал -> floor=None
            Schedule(
                group_id=g2.id, teacher_id=t2.id, subject_id=s_eng.id,
                day_of_week=4, lesson_number=1, week_type="both", room_override="Спортзал",
                is_active=True, version_id=active_ver.id,
            ),
            # Should be ignored: inactive schedule slot
            Schedule(
                group_id=g2.id, teacher_id=t1.id, subject_id=s_prog.id,
                day_of_week=5, lesson_number=1, week_type="both", is_active=False, version_id=active_ver.id,
            ),
            # Should be ignored: technical teacher "!"
            Schedule(
                group_id=g2.id, teacher_id=t_tech.id, subject_id=s_prog.id,
                day_of_week=5, lesson_number=2, week_type="both", is_active=True, version_id=active_ver.id,
            ),
            # Should be ignored: inactive version
            Schedule(
                group_id=g2.id, teacher_id=t1.id, subject_id=s_prog.id,
                day_of_week=5, lesson_number=3, week_type="both", is_active=True, version_id=old_ver.id,
            ),
            # Should be ignored: inactive group
            Schedule(
                group_id=g_inactive.id, teacher_id=t1.id, subject_id=s_prog.id,
                day_of_week=5, lesson_number=4, week_type="both", is_active=True, version_id=active_ver.id,
            ),
        ])
        await db.commit()

    resp = await client.get("/api/atlas")
    assert resp.status_code == 200
    assert "max-age=60" in resp.headers.get("cache-control", "")

    data = resp.json()
    summary = data["summary"]
    assert summary["groups_count"] == 2
    assert summary["teachers_count"] == 2
    assert summary["subjects_count"] == 2
    assert summary["rooms_count"] == 3
    assert summary["edges_count"] == 3

    groups_by_name = {g["name"]: g for g in data["groups"]}
    assert "АРХ-19-1" not in groups_by_name
    assert groups_by_name["КІ-24-1"]["faculty_name"] == "Комп'ютерні науки"
    assert groups_by_name["КІ-24-1"]["curator_id"] == t1.id
    assert groups_by_name["КІ-24-1"]["lessons_count"] == 3
    assert groups_by_name["КІ-24-2"]["lessons_count"] == 1

    teachers_by_name = {t["name"]: t for t in data["teachers"]}
    assert "!Вакансія" not in teachers_by_name
    assert "Звільнений А.А." not in teachers_by_name
    assert teachers_by_name["Петренко І.І."]["room"] == "312"
    assert teachers_by_name["Петренко І.І."]["lessons_count"] == 3
    assert teachers_by_name["Петренко І.І."]["subjects_count"] == 2
    assert teachers_by_name["Коваленко О.О."]["groups_count"] == 2

    rooms_by_name = {r["name"]: r for r in data["rooms"]}
    assert rooms_by_name["312"]["floor"] == 3
    assert rooms_by_name["204а"]["floor"] == 2
    assert rooms_by_name["Спортзал"]["floor"] is None

    # Repeat call hits cache cleanly and returns identical payload
    resp_cached = await client.get("/api/atlas")
    assert resp_cached.status_code == 200
    assert resp_cached.json() == data
