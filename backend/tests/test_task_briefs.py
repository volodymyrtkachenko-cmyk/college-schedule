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


def test_heuristic_brief_classifies_formats_and_extracts_steps():
    phone_brief = build_heuristic_task_brief(
        "Тест з мереж №2",
        "Пройдіть опитування у Google Forms за темою адресації IPv4.",
        max_points=5,
    )
    assert phone_brief["work_format"] == "phone"
    assert phone_brief["estimated_minutes"] == 15
    assert phone_brief["source"] == "heuristic"
    assert len(phone_brief["steps"]) >= 2

    pc_brief = build_heuristic_task_brief(
        "Лабораторна робота №3",
        "1. Зібрати топологію у Packet Tracer.\n2. Налаштувати VLAN.\n3. Завантажити .pkt та звіт.",
        max_points=12,
    )
    assert pc_brief["work_format"] == "pc"
    assert pc_brief["steps"] == [
        "Зібрати топологію у Packet Tracer",
        "Налаштувати VLAN",
        "Завантажити .pkt та звіт",
    ]

    theory_brief = build_heuristic_task_brief(
        "Конспект лекції №4",
        "Опрацювати параграф 5 та виписати основні формули.",
        max_points=None,
    )
    assert theory_brief["work_format"] == "theory"


@pytest.mark.anyio
async def test_ensure_and_attach_task_briefs_caches_and_upgrades_with_gemini(db_session, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")

    tasks = [
        {
            "id": "cw-1",
            "title": "Лабораторна №1",
            "url": "https://classroom.google.com/c/1/a/1/details",
            "max_points": 12,
        }
    ]
    desc_map = {
        "https://classroom.google.com/c/1/a/1/details": (
            "Необхідно написати скрипт на Python для парсингу CSV та додати тести."
        )
    }

    await ensure_and_attach_task_briefs(db_session, 1, tasks, descriptions_by_url=desc_map)
    await db_session.commit()

    assert tasks[0]["brief"]["source"] == "heuristic"
    assert tasks[0]["brief"]["work_format"] == "pc"

    # Now enable Gemini API key and verify cached heuristic row upgrades cleanly via Gemini
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
                                    "Здати код у Classroom",
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
        tasks_second = [dict(tasks[0])]
        tasks_second[0].pop("brief", None)
        await ensure_and_attach_task_briefs(db_session, 1, tasks_second, descriptions_by_url=desc_map)
        await db_session.commit()

    assert post_mock.await_count == 1
    assert tasks_second[0]["brief"]["source"] == "gemini"
    assert tasks_second[0]["brief"]["estimated_minutes"] == 45
    assert "Python-парсер CSV" in tasks_second[0]["brief"]["summary"]

    # Third call with identical description must reuse DB cache with ZERO LLM calls
    with patch("app.services.classroom.task_briefs.httpx.AsyncClient.post", AsyncMock()) as no_call_mock:
        tasks_third = [dict(tasks[0])]
        tasks_third[0].pop("brief", None)
        await ensure_and_attach_task_briefs(db_session, 1, tasks_third, descriptions_by_url=desc_map)
        assert no_call_mock.await_count == 0
        assert tasks_third[0]["brief"]["source"] == "gemini"

    # Read-only attach path returns DB brief for cached URL + fallback for uncached URL
    read_tasks = [
        {"id": "cw-1", "title": "Лабораторна №1", "url": "https://classroom.google.com/c/1/a/1/details"},
        {"id": "cw-2", "title": "Тест по теорії", "url": "https://classroom.google.com/c/1/a/2/details"},
    ]
    await attach_cached_briefs(db_session, 1, read_tasks)
    assert read_tasks[0]["brief"]["source"] == "gemini"
    assert read_tasks[1]["brief"]["source"] == "heuristic"
    assert read_tasks[1]["brief"]["work_format"] == "phone"

    stored = (await db_session.scalars(select(ClassroomTaskBrief))).all()
    assert len(stored) == 1
