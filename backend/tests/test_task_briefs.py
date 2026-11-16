import json
from datetime import date
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


def test_extract_coursework_materials_reads_clickable_urls_kinds_and_student_copy():
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
                "driveFile": {
                    "shareMode": "STUDENT_COPY",
                    "driveFile": {
                        "id": "doc-1",
                        "title": "Бланк_звіту.docx",
                        "alternateLink": "https://docs.google.com/document/d/doc-1/edit",
                    },
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
            "title": "Бланк_звіту.docx",
            "url": "https://docs.google.com/document/d/doc-1/edit",
            "kind": "doc",
            "share_mode": "student_copy",
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

    copy_only = build_heuristic_task_brief("Звіт", "", materials=[mats[1]])
    assert copy_only["deliverable"] == "Заповнити видану копію документа та здати в Classroom"
    assert copy_only["materials"] == [
        {
            "title": "Бланк_звіту.docx",
            "url": "https://docs.google.com/document/d/doc-1/edit",
            "kind": "doc",
        }
    ]


@pytest.mark.anyio
async def test_ensure_and_attach_task_briefs_prioritizes_upcoming_and_skips_empty_files_from_llm(db_session, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")

    tasks = [
        {
            "id": "cw-old-overdue",
            "title": "Старий вересневий борг",
            "subject": "Історія",
            "url": "https://classroom.google.com/c/1/a/old/details",
            "state": "NEW",
            "due_date": "2026-09-05",
            "creation_time": "2026-09-01T10:00:00+03:00",
            "max_points": 5,
        },
        {
            "id": "cw-done",
            "title": "Здане на завтра",
            "subject": "Математика",
            "url": "https://classroom.google.com/c/1/a/done/details",
            "state": "TURNED_IN",
            "due_date": "2026-11-17",
            "creation_time": "2026-11-10T10:00:00+02:00",
            "max_points": 5,
        },
        {
            "id": "cw-file-no-desc",
            "title": "Лише файл на завтра",
            "subject": "Фізика",
            "url": "https://classroom.google.com/c/1/a/fileonly/details",
            "state": "NEW",
            "due_date": "2026-11-17",
            "creation_time": "2026-11-15T10:00:00+02:00",
            "max_points": 12,
        },
        {
            "id": "cw-upcoming",
            "title": "Лабораторна №1",
            "subject": "Комп'ютерні мережі",
            "url": "https://classroom.google.com/c/1/a/upcoming/details",
            "state": "NEW",
            "due_date": "2026-11-18",
            "creation_time": "2026-11-12T10:00:00+02:00",
            "max_points": 12,
        },
        {
            "id": "cw-fresh-nodate",
            "title": "Свіже без дати",
            "subject": "Бази даних",
            "url": "https://classroom.google.com/c/1/a/fresh/details",
            "state": "NEW",
            "due_date": None,
            "creation_time": "2026-11-15T14:00:00+02:00",
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
        "https://classroom.google.com/c/1/a/old/details": (
            "Стара робота з вересня з довгим описом, яка НЕ має перехоплювати ліміт."
        ),
        "https://classroom.google.com/c/1/a/done/details": (
            "Уже здана робота з довгим описом, вона має найнижчий пріоритет."
        ),
        "https://classroom.google.com/c/1/a/upcoming/details": (
            "Налаштувати статичну маршрутизацію між двома мережами та перевірити ping."
        ),
        "https://classroom.google.com/c/1/a/fresh/details": (
            "Спроєктувати ER-діаграму бази даних бібліотеки у форматі SQL або Draw.io."
        ),
    }
    mats_map = {
        "https://classroom.google.com/c/1/a/fileonly/details": [
            {
                "title": "Завдання_фізика.pdf",
                "url": "https://drive.google.com/file/d/phys1/view",
                "kind": "pdf",
            }
        ],
        "https://classroom.google.com/c/1/a/upcoming/details": [
            {
                "title": "Схема.pkt",
                "url": "https://drive.google.com/file/d/pkt1/view",
                "kind": "file",
            }
        ],
    }
    topics_map = {
        "https://classroom.google.com/c/1/a/upcoming/details": "Модуль 2. Маршрутизація",
    }

    await ensure_and_attach_task_briefs(
        db_session,
        1,
        tasks,
        descriptions_by_url=desc_map,
        materials_by_url=mats_map,
        topics_by_url=topics_map,
        today=date(2026, 11, 16),
    )
    await db_session.commit()

    # Empty description + file -> heuristic with clickable PDF, never None
    assert tasks[2]["brief"]["source"] == "heuristic"
    assert tasks[2]["brief"]["materials"][0]["url"] == "https://drive.google.com/file/d/phys1/view"
    # Bare task with neither description nor materials -> None
    assert tasks[5]["brief"] is None

    # Inject a stale legacy "gemini" row on fileonly (which has no description) to ensure downgrade works cleanly
    stale_row = await db_session.scalar(
        select(ClassroomTaskBrief).where(
            ClassroomTaskBrief.task_url == "https://classroom.google.com/c/1/a/fileonly/details"
        )
    )
    stale_row.source = "gemini"
    stale_row.summary = "Вигаданий старий бриф"
    await db_session.commit()

    monkeypatch.setattr(settings, "gemini_api_key", "fake-test-key")
    captured_prompts: list[str] = []

    class _FakeResp:
        status_code = 200

        def json(self):
            return {
                "steps": [
                    {
                        "type": "model_output",
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(
                                    {
                                        "summary": "Налаштувати маршрутизацію та перевірити доступність вузлів.",
                                        "deliverable": "Файл .pkt та скріншоти ping",
                                        "estimated_minutes": None,
                                        "work_format": "pc",
                                    },
                                    ensure_ascii=False,
                                ),
                            }
                        ],
                    }
                ]
            }

    async def _fake_post(self, url, **kwargs):
        captured_prompts.append(kwargs["json"]["input"])
        return _FakeResp()

    with patch("app.services.classroom.task_briefs.httpx.AsyncClient.post", _fake_post):
        tasks_second = [dict(t) for t in tasks]
        for t in tasks_second:
            t.pop("brief", None)
        await ensure_and_attach_task_briefs(
            db_session,
            1,
            tasks_second,
            descriptions_by_url=desc_map,
            materials_by_url=mats_map,
            topics_by_url=topics_map,
            max_llm_calls=2,
            today=date(2026, 11, 16),
        )
        await db_session.commit()

    # Only the 2 highest-priority unsubmitted tasks with rich description should call Gemini:
    # 1) cw-upcoming (due 2026-11-18), 2) cw-fresh-nodate (fresh no due_date)
    # cw-old-overdue, cw-done, and cw-file-no-desc MUST NOT consume the 2 LLM slots!
    assert len(captured_prompts) == 2
    assert any("Предмет: Комп'ютерні мережі" in p and "Тема курсу: Модуль 2. Маршрутизація" in p for p in captured_prompts)
    assert all("НЕ можеш відкривати й читати" in p for p in captured_prompts)

    by_id = {t["id"]: t for t in tasks_second}
    assert by_id["cw-upcoming"]["brief"]["source"] == "gemini"
    assert by_id["cw-upcoming"]["brief"]["deliverable"] == "Файл .pkt та скріншоти ping"
    assert by_id["cw-upcoming"]["brief"]["materials"][0]["url"] == "https://drive.google.com/file/d/pkt1/view"
    assert by_id["cw-fresh-nodate"]["brief"]["source"] == "gemini"
    assert by_id["cw-old-overdue"]["brief"]["source"] == "heuristic"
    assert by_id["cw-done"]["brief"]["source"] == "heuristic"
    # Stale legacy AI row without description downgraded cleanly back to honest heuristic + PDF
    assert by_id["cw-file-no-desc"]["brief"]["source"] == "heuristic"
    assert by_id["cw-file-no-desc"]["brief"]["summary"] == ""

    read_tasks = [
        {"id": "cw-upcoming", "title": "Лабораторна №1", "url": "https://classroom.google.com/c/1/a/upcoming/details"},
        {"id": "cw-bare", "title": "Практична №2", "url": "https://classroom.google.com/c/1/a/bare/details"},
    ]
    await attach_cached_briefs(db_session, 1, read_tasks)
    assert read_tasks[0]["brief"]["source"] == "gemini"
    assert read_tasks[1]["brief"] is None

    stored = (await db_session.scalars(select(ClassroomTaskBrief))).all()
    assert len(stored) == 6
