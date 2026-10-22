import pytest
from unittest.mock import MagicMock
from app.services.classroom_access import (
    sanitize_note_for_guest,
    sanitize_room_for_guest,
    check_classroom_group_access,
)
from app.models import ClassroomCredential, GroupStudent


def test_sanitize_note_masks_meet_and_zoom():
    note = (
        "Токарєва: https://meet.google.com/abc-defg-hij\n"
        "Пароль: 123456\n"
        "[TASK] Лабораторна робота 1 | https://classroom.google.com/c/123/a/456\n"
        "Звичайна примітка для пари"
    )
    sanitized, had_meeting = sanitize_note_for_guest(note)
    assert had_meeting is True
    assert "https://meet.google.com" not in sanitized
    assert "123456" not in sanitized
    assert "[TASK]" not in sanitized
    assert "https://classroom.google.com" not in sanitized
    assert "🔒 Онлайн" in sanitized
    assert "Звичайна примітка для пари" in sanitized


def test_sanitize_note_leaves_regular_text():
    note = "Принести зошити та калькулятори"
    sanitized, had_meeting = sanitize_note_for_guest(note)
    assert had_meeting is False
    assert sanitized == "Принести зошити та калькулятори"


def test_sanitize_room_replaces_url_with_online():
    room = "https://zoom.us/j/987654321"
    sanitized, had_meeting = sanitize_room_for_guest(room)
    assert had_meeting is True
    assert sanitized == "Онлайн"

    normal_room = "ауд. 305"
    sanitized_normal, had_meeting_normal = sanitize_room_for_guest(normal_room)
    assert had_meeting_normal is False
    assert sanitized_normal == "ауд. 305"


from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.database import Base
from app.models import Group


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        # Create group 85 and 99
        session.add(Group(id=85, name="85 ДФКР"))
        session.add(Group(id=99, name="99 ДФКР"))
        await session.commit()
        yield session
    await engine.dispose()


@pytest.mark.anyio
async def test_check_classroom_group_access_unauthorized_guest(db_session):
    request = MagicMock()
    request.headers = {}
    request.query_params = {}

    has_access = await check_classroom_group_access(db_session, group_id=85, request=request)
    assert has_access is False


@pytest.mark.anyio
async def test_check_classroom_group_access_authorized_student(db_session):
    # Create test credential
    cred = ClassroomCredential(
        group_id=85,
        google_user_id="google_test_uid_123",
        email="student@college.edu",
        student_name="Іван Тестовий",
        is_active=True,
    )
    db_session.add(cred)
    await db_session.commit()

    request = MagicMock()
    request.headers = {"x-classroom-user-id": "google_test_uid_123"}
    request.query_params = {}

    has_access = await check_classroom_group_access(db_session, group_id=85, request=request)
    assert has_access is True

    # But for a different group_id, access should be False
    has_other_access = await check_classroom_group_access(db_session, group_id=99, request=request)
    assert has_other_access is False
