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

    # Re-calling with different subject normalization / missing topics (e.g. /user-submissions or 2nd device)
    # MUST keep the exact cached Gemini brief without regenerating or changing text.
    captured_prompts.clear()
    tasks_reload = [
        {
            "id": "cw-upcoming",
            "title": "Лабораторна №1",
            "subject": "Мережі (Іванов І.І.)",
            "url": "https://classroom.google.com/c/1/a/upcoming/details",
            "state": "NEW",
            "due_date": "2026-11-18",
            "creation_time": "2026-11-12T10:00:00+02:00",
            "max_points": 12,
        }
    ]
    with patch("app.services.classroom.task_briefs.httpx.AsyncClient.post", _fake_post):
        await ensure_and_attach_task_briefs(
            db_session,
            1,
            tasks_reload,
            descriptions_by_url=desc_map,
            materials_by_url=mats_map,
            topics_by_url={},
            max_llm_calls=12,
            today=date(2026, 11, 16),
        )
    assert len(captured_prompts) == 0
    assert tasks_reload[0]["brief"]["summary"] == by_id["cw-upcoming"]["brief"]["summary"]
    assert tasks_reload[0]["brief"]["deliverable"] == by_id["cw-upcoming"]["brief"]["deliverable"]


@pytest.mark.anyio
async def test_long_brief_summary_is_not_chopped_at_240_and_legacy_truncated_rows_refresh(db_session, monkeypatch):
    long_summary = (
        "Подивіться два навчальні відео та дайте письмові відповіді на п'ять запитань із завдання: "
        "поясніть поняття вставних слів і складного речення, наведіть приклади вставних слів у діловому стилі, "
        "розкрийте дужки в запропонованих словосполученнях та перелічіть основні види підрядних речень."
    )
    assert len(long_summary) > 280
    long_mat_title = "Вставні слова та складні випадки пунктуації у діловому мовленні (повний конспект відеоуроку для самостійного опрацювання)"
    task_url = "https://classroom.google.com/c/1/a/ukrmova/details"

    # Seed a legacy truncated DB row matching the exact old 240-char cut bug
    legacy_row = ClassroomTaskBrief(
        group_id=1,
        task_url=task_url,
        content_hash="",  # replaced right below after helper computes canonical v5 hash
        summary=long_summary[:240],
        steps_json=json.dumps({"steps": [], "materials": [{"title": long_mat_title[:100], "url": "https://youtu.be/abc", "kind": "video"}]}, ensure_ascii=False),
        estimated_minutes=None,
        work_format="theory",
        source="gemini",
    )
    from app.services.classroom.task_briefs import compute_task_content_hash

    desc = "Перегляньте обидва відео та виконайте вправи 1–5 у зошиті письмово."
    mats = [{"title": long_mat_title, "url": "https://youtu.be/abc", "kind": "video"}]
    legacy_row.content_hash = compute_task_content_hash("Завдання зі вставних слів", desc, 5, materials=mats)
    db_session.add(legacy_row)
    await db_session.commit()

    monkeypatch.setattr(settings, "gemini_api_key", "fake-test-key")
    llm_calls = 0

    class _LongResp:
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
                                        "summary": long_summary,
                                        "deliverable": "Письмові відповіді на запитання та виконані вправи у зошиті",
                                        "estimated_minutes": None,
                                        "work_format": "theory",
                                    },
                                    ensure_ascii=False,
                                ),
                            }
                        ],
                    }
                ]
            }

    async def _fake_post(self, url, **kwargs):
        nonlocal llm_calls
        llm_calls += 1
        return _LongResp()

    task_entry = {
        "id": "cw-ukrmova",
        "title": "Завдання зі вставних слів",
        "url": task_url,
        "state": "NEW",
        "due_date": "2026-11-21",
        "max_points": 5,
    }
    with patch("app.services.classroom.task_briefs.httpx.AsyncClient.post", _fake_post):
        await ensure_and_attach_task_briefs(
            db_session,
            1,
            [task_entry],
            descriptions_by_url={task_url: desc},
            materials_by_url={task_url: mats},
            today=date(2026, 11, 16),
        )
        await db_session.commit()

    # Truncated legacy row must be regenerated once cleanly with the full sentence intact
    assert llm_calls == 1
    assert task_entry["brief"]["summary"] == long_summary
    assert task_entry["brief"]["materials"][0]["title"] == long_mat_title

    # Subsequent sync must NOT re-call Gemini because the complete sentence is now cached
    task_second = dict(task_entry)
    task_second.pop("brief", None)
    with patch("app.services.classroom.task_briefs.httpx.AsyncClient.post", _fake_post):
        await ensure_and_attach_task_briefs(
            db_session,
            1,
            [task_second],
            descriptions_by_url={task_url: desc},
            materials_by_url={task_url: mats},
            today=date(2026, 11, 16),
        )
    assert llm_calls == 1
    assert task_second["brief"]["summary"] == long_summary


def test_smart_trim_text_respects_sentence_and_word_boundaries():
    from app.services.classroom.task_briefs import _smart_trim_text

    short = "Коротке речення."
    assert _smart_trim_text(short, 100) == short

    two_sentences = "Подивіться навчальне відео та випишіть правила. Виконайте п'ять практичних вправ у робочому зошиті."
    trimmed_sentence = _smart_trim_text(two_sentences, 65)
    assert trimmed_sentence == "Подивіться навчальне відео та випишіть правила."

    long_single_clause = "Поясніть поняття вставних слів і складного речення, наведіть приклади вставних слів у діловому стилі та розкрийте дужки"
    trimmed_words = _smart_trim_text(long_single_clause, 60)
    assert trimmed_words.endswith("…")
    assert len(trimmed_words) <= 60
    assert "перелічі" not in trimmed_words
    # Must never end in the middle of a word before the ellipsis
    word_before_ellipsis = trimmed_words[:-1].split()[-1]
    assert word_before_ellipsis in [w.strip(" ,;:-—–") for w in long_single_clause.split()]
