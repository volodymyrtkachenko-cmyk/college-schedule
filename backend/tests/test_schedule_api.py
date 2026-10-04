import pytest
from httpx import AsyncClient, ASGITransport
from datetime import time, date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import (
    BellSchedule,
    Curriculum,
    Faculty,
    Group,
    ImportedScheduleChange,
    Schedule,
    ScheduleDraft,
    ScheduleOverride,
    ScheduleSlot,
    Subject,
    Teacher,
    User,
)
from app.core.security import create_access_token
from app.routers.admin_import import import_payload_hash

@pytest.fixture
async def api_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        
    async def override_get_db():
        async with sessions() as session:
            yield session
            
    app.dependency_overrides[get_db] = override_get_db
    
    async with sessions() as session:
        faculty = Faculty(name="Test Faculty")
        subject = Subject(name="Test Subject")
        teacher = Teacher(name="Test Teacher", room="Room 101")
        admin = User(username="admin", name="admin", role="admin", password_hash="hash")
        
        session.add_all([faculty, subject, teacher, admin])
        await session.flush()
        
        group = Group(name="Test Group", faculty_id=faculty.id)

        subject2 = Subject(name="Different Subject")
        session.add(subject2)
        group2 = Group(name="Another Group", faculty_id=faculty.id)
        session.add_all([group, group2])
        await session.flush()
        
        bell = BellSchedule(lesson_number=1, start_time=time(9,0), end_time=time(10,20), is_active=True)
        session.add(bell)
        
        sched = Schedule(
            group_id=group.id, subject_id=subject.id, teacher_id=teacher.id,
            day_of_week=1, lesson_number=1, week_type="both", is_active=True
        )
        session.add(sched)
        await session.commit()
        
        token = create_access_token(admin)
        headers = {"Authorization": f"Bearer {token}"}
        
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, headers, {
                "group_id": group.id,
                "group2_id": group2.id,
                "teacher_id": teacher.id,
                "subject_id": subject.id,
                "different_subject_id": subject2.id,
                "lesson_id": sched.id,
                "sessions": sessions,
            }
            
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.anyio
async def test_schedule_week_returns_200_and_time(api_client):
    client, _, data = api_client
    resp = await client.get(f"/api/schedule/week?group_id={data['group_id']}&target_date=2025-09-01")
    assert resp.status_code == 200
    days = resp.json()
    assert len(days) > 0
    assert days[0]["lessons"][0]["time"] == "09:00-10:20"


@pytest.mark.anyio
async def test_schedule_returns_published_imported_substitution(api_client):
    client, _, data = api_client
    async with data["sessions"]() as session:
        session.add(
            ImportedScheduleChange(
                date=date(2025, 9, 1),
                kind="substitution",
                group_id=data["group_id"],
                subject_id=data["different_subject_id"],
                teacher_id=data["teacher_id"],
                lesson_number=1,
                room_override="Room 202",
                is_published=True,
                version=1,
            )
        )
        await session.commit()

    response = await client.get(
        f"/api/schedule?group_id={data['group_id']}&target_date=2025-09-01"
    )
    assert response.status_code == 200
    lessons = response.json()["lessons"]
    assert len(lessons) == 1
    assert lessons[0]["subject_name"] == "Different Subject"
    assert lessons[0]["room"] == "Room 202"
    assert lessons[0]["is_replacement"] is True

@pytest.mark.anyio
async def test_schedule_teacher_conflict_gives_409(api_client):
    client, headers, data = api_client
    # Try to schedule another group at same time with same teacher, BUT DIFFERENT subject
    payload = {
        "group_id": data["group2_id"],
        "subject": "Different Subject",
        "teacher_id": data["teacher_id"],
        "day_of_week": 1,
        "lesson_number": 1,
        "week_type": "both"
    }
    resp = await client.post("/api/schedule", json=payload, headers=headers)
    assert resp.status_code == 409
    assert "Викладач уже веде заняття" in resp.json()["detail"]

@pytest.mark.anyio
async def test_schedule_teacher_conflict_not_bypassed_by_matching_subject(api_client):
    client, headers, data = api_client
    # "Потік": same teacher, same subject, same time slot, different group
    payload = {
        "group_id": data["group2_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "day_of_week": 1,
        "lesson_number": 1,
        "week_type": "both"
    }
    resp = await client.post("/api/schedule", json=payload, headers=headers)
    assert resp.status_code == 409


@pytest.mark.anyio
async def test_schedule_teacher_conflict_allowed_for_explicit_stream(api_client):
    client, headers, data = api_client
    async with data["sessions"]() as session:
        session.add_all([
            Curriculum(
                group_id=data["group_id"], subject_id=data["subject_id"], teacher_id=data["teacher_id"],
                pairs_per_2_weeks=2, total_hours=0, is_stream=True, stream_id="explicit-stream",
            ),
            Curriculum(
                group_id=data["group2_id"], subject_id=data["subject_id"], teacher_id=data["teacher_id"],
                pairs_per_2_weeks=2, total_hours=0, is_stream=True, stream_id="explicit-stream",
            ),
        ])
        existing = await session.get(Schedule, data["lesson_id"])
        existing.stream_id = "explicit-stream"
        await session.commit()

    payload = {
        "group_id": data["group2_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "day_of_week": 1,
        "lesson_number": 1,
        "week_type": "both",
    }
    response = await client.post("/api/schedule", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json()["stream_id"] == "explicit-stream"


@pytest.mark.anyio
async def test_schedule_teacher_conflict_not_allowed_for_different_explicit_streams(api_client):
    client, headers, data = api_client
    async with data["sessions"]() as session:
        session.add_all([
            Curriculum(
                group_id=data["group_id"], subject_id=data["subject_id"], teacher_id=data["teacher_id"],
                pairs_per_2_weeks=2, total_hours=0, is_stream=True, stream_id="stream-one",
            ),
            Curriculum(
                group_id=data["group2_id"], subject_id=data["subject_id"], teacher_id=data["teacher_id"],
                pairs_per_2_weeks=2, total_hours=0, is_stream=True, stream_id="stream-two",
            ),
        ])
        existing = await session.get(Schedule, data["lesson_id"])
        existing.stream_id = "stream-one"
        await session.commit()

    response = await client.post("/api/schedule", json={
        "group_id": data["group2_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "day_of_week": 1,
        "lesson_number": 1,
        "week_type": "both",
    }, headers=headers)
    assert response.status_code == 409


@pytest.mark.anyio
async def test_new_stream_loads_get_distinct_ids_unless_added_as_one_grouped_stream(api_client):
    client, headers, data = api_client
    payload = {
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "pairs_per_2_weeks": 2,
        "total_hours": 0,
        "is_stream": True,
    }
    first = await client.post(
        "/api/curriculums/",
        json={**payload, "group_id": data["group_id"]},
        headers=headers,
    )
    second = await client.post(
        "/api/curriculums/",
        json={**payload, "group_id": data["group2_id"]},
        headers=headers,
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["stream_id"] != second.json()["stream_id"]

    shared_payload = {**payload, "stream_id": "grouped-stream"}
    shared_first = await client.post(
        "/api/curriculums/",
        json={**shared_payload, "group_id": data["group_id"]},
        headers=headers,
    )
    shared_second = await client.post(
        "/api/curriculums/",
        json={**shared_payload, "group_id": data["group2_id"]},
        headers=headers,
    )
    assert shared_first.status_code == shared_second.status_code == 200
    assert shared_first.json()["stream_id"] == shared_second.json()["stream_id"] == "grouped-stream"


@pytest.mark.anyio
async def test_stream_id_cannot_join_different_subjects_or_teachers(api_client):
    client, headers, data = api_client
    payload = {
        "group_id": data["group_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "pairs_per_2_weeks": 2,
        "total_hours": 0,
        "is_stream": True,
        "stream_id": "shared-stream",
    }
    first = await client.post("/api/curriculums/", json=payload, headers=headers)
    assert first.status_code == 200

    incompatible = await client.post(
        "/api/curriculums/",
        json={
            **payload,
            "group_id": data["group2_id"],
            "subject_id": data["different_subject_id"],
        },
        headers=headers,
    )
    assert incompatible.status_code == 409


@pytest.mark.anyio
async def test_publishing_carries_explicit_stream_id_to_schedule(api_client):
    client, headers, data = api_client
    async with data["sessions"]() as session:
        curriculum = Curriculum(
            group_id=data["group_id"],
            subject_id=data["subject_id"],
            teacher_id=data["teacher_id"],
            pairs_per_2_weeks=2,
            total_hours=0,
            is_stream=True,
            stream_id="published-stream",
        )
        draft = ScheduleDraft(name="Stream draft", status="DRAFT")
        session.add_all([curriculum, draft])
        await session.flush()
        session.add(ScheduleSlot(
            draft_id=draft.id,
            curriculum_id=curriculum.id,
            day_of_week=1,
            lesson_number=2,
            week_type="both",
        ))
        await session.commit()
        draft_id = draft.id

    draft_slots = await client.get(f"/api/drafts/{draft_id}/slots", headers=headers)
    assert draft_slots.status_code == 200
    assert draft_slots.json()[0]["curriculum"]["teacher"]["room"] == "Room 101"

    published = await client.post(f"/api/drafts/{draft_id}/publish", headers=headers)
    assert published.status_code == 200
    schedule = await client.get(
        f"/api/schedule?group_id={data['group_id']}&target_date=2025-09-01"
    )
    assert schedule.status_code == 200
    assert schedule.json()["lessons"][0]["stream_id"] == "published-stream"


@pytest.mark.anyio
async def test_curriculum_delete_removes_generated_draft_slots(api_client):
    client, headers, data = api_client
    async with data["sessions"]() as session:
        curriculum = Curriculum(
            group_id=data["group_id"],
            subject_id=data["subject_id"],
            teacher_id=data["teacher_id"],
            pairs_per_2_weeks=2,
            total_hours=0,
        )
        draft = ScheduleDraft(name="Delete curriculum draft", status="DRAFT")
        session.add_all([curriculum, draft])
        await session.flush()
        session.add(ScheduleSlot(
            draft_id=draft.id,
            curriculum_id=curriculum.id,
            day_of_week=1,
            lesson_number=1,
            week_type="both",
        ))
        await session.commit()
        curriculum_id = curriculum.id

    response = await client.delete(f"/api/curriculums/{curriculum_id}", headers=headers)
    assert response.status_code == 204

    async with data["sessions"]() as session:
        assert await session.get(Curriculum, curriculum_id) is None
        assert (await session.scalars(
            select(ScheduleSlot).where(ScheduleSlot.curriculum_id == curriculum_id)
        )).first() is None


@pytest.mark.anyio
async def test_deleting_import_draft_removes_import_only_curriculums(api_client):
    client, headers, data = api_client
    async with data["sessions"]() as session:
        curriculum = Curriculum(
            group_id=data["group_id"],
            subject_id=data["subject_id"],
            teacher_id=data["teacher_id"],
            pairs_per_2_weeks=2,
            total_hours=0,
        )
        draft = ScheduleDraft(
            name="Import cleanup",
            draft_type="import",
            status="archived",
            data={"created_curriculum_ids": []},
        )
        session.add_all([curriculum, draft])
        await session.flush()
        draft.data = {"created_curriculum_ids": [curriculum.id]}
        session.add(ScheduleSlot(
            draft_id=draft.id,
            curriculum_id=curriculum.id,
            day_of_week=1,
            lesson_number=1,
            week_type="both",
        ))
        await session.commit()
        draft_id = draft.id
        curriculum_id = curriculum.id

    response = await client.delete(f"/api/drafts/{draft_id}", headers=headers)
    assert response.status_code == 204

    async with data["sessions"]() as session:
        assert await session.get(Curriculum, curriculum_id) is None


def test_import_payload_hash_ignores_collection_order_and_technical_ids():
    first = {
        "base_slots": [
            {"group_id": 2, "subject_id": 3, "day_of_week": 2},
            {"group_id": 1, "subject_id": 4, "day_of_week": 1},
        ],
        "substitutions": [{"date": "2026-10-06", "group_id": 1, "lesson_number": 2}],
        "cancelled": [{"date": "2026-10-07", "group_id": 2, "lesson_number": 1}],
        "created_curriculum_ids": [10, 11],
    }
    second = {
        "base_slots": list(reversed(first["base_slots"])),
        "substitutions": list(reversed(first["substitutions"])),
        "cancelled": list(reversed(first["cancelled"])),
        "created_curriculum_ids": [99],
    }

    assert import_payload_hash(first) == import_payload_hash(second)


@pytest.mark.anyio
async def test_publishing_removes_old_schedule_overrides_before_replacing_schedule(api_client):
    client, headers, data = api_client
    async with data["sessions"]() as session:
        curriculum = Curriculum(
            group_id=data["group_id"],
            subject_id=data["subject_id"],
            teacher_id=data["teacher_id"],
            pairs_per_2_weeks=2,
            total_hours=0,
        )
        draft = ScheduleDraft(name="Override draft", status="DRAFT")
        session.add_all([curriculum, draft])
        await session.flush()
        session.add_all([
            ScheduleOverride(
                schedule_id=data["lesson_id"],
                date=date(2025, 9, 1),
                cancelled=True,
            ),
            ScheduleSlot(
                draft_id=draft.id,
                curriculum_id=curriculum.id,
                day_of_week=1,
                lesson_number=2,
                week_type="both",
            ),
        ])
        await session.commit()
        draft_id = draft.id

    response = await client.post(f"/api/drafts/{draft_id}/publish", headers=headers)
    assert response.status_code == 200, response.text

    async with data["sessions"]() as session:
        assert (await session.scalars(select(ScheduleOverride))).all() == []


@pytest.mark.anyio
async def test_schedule_invalid_lesson_numbers(api_client):
    client, headers, data = api_client
    payload = {
        "group_id": data["group2_id"],
        "subject_id": data["subject_id"],
        "teacher_id": data["teacher_id"],
        "day_of_week": 1,
        "week_type": "both"
    }
    # lesson 0
    resp = await client.post("/api/schedule", json={**payload, "lesson_number": 0}, headers=headers)
    assert resp.status_code == 422
    # lesson 5
    resp = await client.post("/api/schedule", json={**payload, "lesson_number": 5}, headers=headers)
    assert resp.status_code == 422

@pytest.mark.anyio
async def test_patch_room_override(api_client):
    client, headers, data = api_client
    # Patch with room "205"
    resp = await client.patch(f"/api/schedule/{data['lesson_id']}", json={"room": "205"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["room"] == "205"
    
    # Patch with null
    resp = await client.patch(f"/api/schedule/{data['lesson_id']}", json={"room": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["room"] not in ("205",) # Probably null or fallback
