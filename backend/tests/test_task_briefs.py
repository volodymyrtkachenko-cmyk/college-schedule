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
    assert bare_brief["deliverable"] is None
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


def test_extract_coursework_materials_reads_clickable_urls_and_kinds():
    mats = extract_coursework_materials({
        "materials": [
            {
                "driveFile": {
                    "driveFile": {
                        "id": "pdf-1",
                        "title": "Методичка_4.pdf",
                        "alternateLink": "https://drive.google.com/file/d/pdf-1/view",
                    }
                }
            },
            {
                "form": {
                    "title": "Контрольний тест",
                    "formUrl": "https://docs.google.com/forms/d/e/123/viewform",
                }
            },
            {
                "youtubeVideo": {
                    "id": "yt123",
                    "title": "Огляд VLAN",
                    "alternateLink": "https://www.youtube.com/watch?v=yt123",
                }
            },
            {
                "link": {
                    "title": "Документація",
                    "url": "https://example.com/docs",
                }
            },
        ]
    })
    assert mats == [
        {
            "title": "Методичка_4.pdf",
            "url": "https://drive.google.com/file/d/pdf-1/view",
            "kind": "pdf",
        },
        {
            "title": "Контрольний тест",
            "url": "https://docs.google.com/forms/d/e/123/viewform",
            "kind": "form",
        },
        {
            "title": "Огляд VLAN",
            "url": "https://www.youtube.com/watch?v=yt123",
            "kind": "video",
        },
        {
            "title": "Документація",
            "url": "https://example.com/docs",
            "kind": "link",
        },
    ]


@pytest.mark.anyio
async def test_ensure_and_attach_task_briefs_caches_deliverable_and_clickable_materials(db_session, monkeypatch):
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
    mats_map = {
        "https://classroom.google.com/c/1/a/1/details": [
            {
                "title": "Приклад_CSV.pdf",
                "url": "https://drive.google.com/file/d/csv1/view",
                "kind": "pdf",
            }
        ]
    }

    await ensure_and_attach_task_briefs(
        db_session,
        1,
        tasks,
        descriptions_by_url=desc_map,
        materials_by_url=mats_map,
    )
    await db_session.commit()

    assert tasks[1]["brief"]["source"] == "heuristic"
    assert tasks[1]["brief"]["materials"] == mats_map["https://classroom.google.com/c/1/a/1/details"]
    assert tasks[2]["brief"] is None

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
                                "summary": "Реалізувати парсер CSV на Python і покрити базовими тестами.",
                                "deliverable": "Файл parser.py та скріншот проходження тестів",
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
            materials_by_url=mats_map,
            max_llm_calls=1,
        )
        await db_session.commit()

    assert post_mock.await_count == 1
    assert tasks_second[1]["brief"]["source"] == "gemini"
    assert tasks_second[1]["brief"]["deliverable"] == "Файл parser.py та скріншот проходження тестів"
    assert tasks_second[1]["brief"]["materials"][0]["url"] == "https://drive.google.com/file/d/csv1/view"
    assert tasks_second[1]["brief"]["estimated_minutes"] == 45

    read_tasks = [
        {"id": "cw-1", "title": "Лабораторна №1", "url": "https://classroom.google.com/c/1/a/1/details"},
        {"id": "cw-bare", "title": "Практична №2", "url": "https://classroom.google.com/c/1/a/bare/details"},
    ]
    await attach_cached_briefs(db_session, 1, read_tasks)
    assert read_tasks[0]["brief"]["source"] == "gemini"
    assert read_tasks[0]["brief"]["deliverable"] == "Файл parser.py та скріншот проходження тестів"
    assert read_tasks[1]["brief"] is None

    stored = (await db_session.scalars(select(ClassroomTaskBrief))).all()
    assert len(stored) == 3
