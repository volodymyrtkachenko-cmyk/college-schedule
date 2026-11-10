import pytest
from sqlalchemy import select
from app.models.entities import Schedule, ScheduleVersion, Group, Subject, Teacher
from app.routers.admin_import import sync_permanent_schedule_endpoint, PermanentSyncRequest
from tests.test_auto_import_publish import ctx

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_sync_permanent_schedule_endpoint(ctx):
    db, ids = ctx
    grp_id = ids["group_id"]
    subj_id = ids["subject_id"]
    teach_id = ids["teacher_id"]
    version_id = ids["version_id"]

    payload = PermanentSyncRequest(
        version_id=version_id,
        lessons=[
            {
                "group_id": grp_id,
                "day_of_week": 1,
                "lesson_number": 1,
                "subject_id": subj_id,
                "teacher_id": teach_id,
                "room_override": "101",
                "week_type": "both"
            },
            {
                "group_id": grp_id,
                "day_of_week": 4,
                "lesson_number": 4,
                "subject_id": subj_id,
                "teacher_id": teach_id,
                "room_override": "101",
                "week_type": "both"
            }
        ]
    )

    result = await sync_permanent_schedule_endpoint(payload=payload, db=db, _=None)
    assert result["status"] == "success"
    assert result["synced_lessons_count"] == 2

    # Check rows in DB
    rows = (await db.scalars(select(Schedule).where(Schedule.version_id == version_id))).all()
    assert len(rows) == 2
