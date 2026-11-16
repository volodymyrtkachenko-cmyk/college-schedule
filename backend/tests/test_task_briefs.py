import json
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.database import Base
from app.models import ClassroomTaskBrief, Group
from app.services.classroom.task_briefs import (
    attach_cached_briefs,
    build_heuristic_task_brief,
    ensure_and_attach_task_briefs,
    extract_coursework_materials,
)


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        session.add(Group(id=1, name="КІ-24-1"))
        await session.commit()
        yield session
    await engine.dispose()


def test_heuristic_brief_stays_honest_without_inventing_minutes_or_boilerplate():
    bare_brief = build_heuristic_task_brief("Лабораторна №4", "", max_points=12)
    assert bare_brief["summary"] == ""
    assert bare_brief["steps"] == []
    assert bare_brief["estimated_minutes"] is None

    explicit_time_brief = build_heuristic_task_brief(
        "Тест з мереж №2",
        "Пройдіть опитування за 20 хв за темою адресації IPv4.",
        max_points=5,
    )
    assert explicit_time_brief["work_format"] == "phone"
    assert explicit_time_brief["estimated_minutes"] == 20
    assert "IPv4" in explicit_time_brief["summary"]

    pc_brief = build_heuristic_task_brief(
        "Лабораторна робота №3",
        "1. Зібрати топологію у Packet Tracer.\n2. Налаштувати VLAN.\n3. Завантажити .pkt та звіт.",
        max_points=12,
    )
    assert pc_brief["work_format"] == "pc"
    assert pc_brief["estimated_minutes"] is None
    assert pc_brief["steps"] == [
        "Зібрати топологію у Packet Tracer",
        "Налаштувати VLAN",
        "Завантажити .pkt та звіт",
    ]


def test_extract_coursework_materials_reads_files_forms_and_videos():
    mats = extract_coursework_materials({
        "materials": [
            {"driveFile": {"driveFile": {"title": "Методичка_4.pdf"}}},
            {"form": {"title": "Контрольний тест"}},
            {"youtubeVideo": {"title": "Огляд VLAN"}},
            {"link": {"title": "Приклад коду"}},
        ]
    })
    assert mats == [
        "Файл: Методичка_4.pdf",
        "Google Форма: Контрольний тест",
        "Відео: Огляд VLAN",
        "Посилання: Приклад коду",
    ]


@pytest.mark.anyio
async def test_ensure_and_attach_task_briefs_prioritizes_active_and_upgrades_with_gemini(db_session, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")

    tasks = [
        {
            "id": "cw-done",
            "title": "Стара робота",
            "url": "https://classroom.google.com/c/1/a/done/details",
            "state": "TURNED_IN",
            "due_date": "2026-09-10",
            "max_points": 5,
        },
        {
            "id": "cw-1",
            "title": "Лабораторна №1",
            "url": "https://classroom.google.com/c/1/a/1/details",
            "state": "NEW",
            "due_date": "2026-11-20",
            "max_points": 12,
        },
        {
            "id": "cw-bare",
            "title": "Практична №2",
            "url": "https://classroom.google.com/c/1/a/bare/details",
            "state": "NEW",
            "max_points": 12,
        },
    ]
    desc_map = {
        "https://classroom.google.com/c/1/a/1/details": (
            "Необхідно написати скрипт на Python для парсингу CSV та додати тести."
        ),
        "https://classroom.google.com/c/1/a/done/details": (
            "Старе завдання з описом, яке вже здано і не повинно забирати квоту першим."
        ),
    }

    await ensure_and_attach_task_briefs(db_session, 1, tasks, descriptions_by_url=desc_map)
    await db_session.commit()

    assert tasks[1]["brief"]["source"] == "heuristic"
    assert tasks[1]["brief"]["work_format"] == "pc"
    # Bare task with no description/materials must NOT expose empty boilerplate brief
    assert tasks[2]["brief"] is None

    # Enable Gemini API with max_llm_calls=1 -> active cw-1 must be chosen before done cw-done!
    monkeypatch.setattr(settings, "gemini_api_key", "fake-test-key")
    gemini_payload = {
        "steps": [
            {
                "type": "model_output",
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "summary": "Написати Python-парсер CSV і покрити його тестами.",
                                "steps": [
                                    "Реалізувати читання CSV",
                                    "Додати unit-тести",
                                ],
                                "estimated_minutes": 45,
                                "work_format": "pc",
                            },
                            ensure_ascii=False,
                        ),
                    }
                ],
            }
        ]
    }

    class _FakeResp:
        status_code = 200

        def json(self):
            return gemini_payload

    post_mock = AsyncMock(return_value=_FakeResp())
    with patch("app.services.classroom.task_briefs.httpx.AsyncClient.post", post_mock):
        tasks_second = [dict(t) for t in tasks]
        for t in tasks_second:
            t.pop("brief", None)
        await ensure_and_attach_task_briefs(
            db_session,
            1,
            tasks_second,
            descriptions_by_url=desc_map,
            max_llm_calls=1,
        )
        await db_session.commit()

    assert post_mock.await_count == 1
    assert tasks_second[1]["brief"]["source"] == "gemini"
    assert tasks_second[1]["brief"]["estimated_minutes"] == 45
    assert tasks_second[0]["brief"]["source"] == "heuristic"

    # Read-only attach path preserves substantive DB brief and keeps bare tasks brief=None
    read_tasks = [
        {"id": "cw-1", "title": "Лабораторна №1", "url": "https://classroom.google.com/c/1/a/1/details"},
        {"id": "cw-bare", "title": "Практична №2", "url": "https://classroom.google.com/c/1/a/bare/details"},
    ]
    await attach_cached_briefs(db_session, 1, read_tasks)
    assert read_tasks[0]["brief"]["source"] == "gemini"
    assert read_tasks[1]["brief"] is None

    stored = (await db_session.scalars(select(ClassroomTaskBrief))).all()
    assert len(stored) == 3
