"""Cached task brief extraction (deterministic heuristics + optional Gemini API)."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import ClassroomTaskBrief

logger = logging.getLogger("app")

GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
GEMINI_API_REVISION = "2026-05-20"
VALID_WORK_FORMATS = {"phone", "pc", "theory"}

_PC_KEYWORDS = (
    "packet tracer", ".pkt", "python", ".py", "c++", ".cpp", "java", "javascript",
    "typescript", "code", "код", "програм", "лаборатор", "практичн", "звіт",
    "презентац", "powerpoint", "word", "excel", "таблиц", "схем", "діаграм",
    "github", "git", "архів", ".zip", ".rar", "документ", "реферат", "курсов",
    "скріншот", "віртуальн", "linux", "bash", "sql", "база даних", "html", "css",
)
_PHONE_KEYWORDS = (
    "тест", "опитуван", "вікторин", "гугл форм", "google form", "forms.gle",
    "docs.google.com/forms", "quiz", "kahoot", "відповісти на питання",
    "коротко", "обрати варіант", "пройти тест",
)
_THEORY_KEYWORDS = (
    "конспект", "лекці", "прочита", "опрацюва", "вивчи", "підручник", "теорі",
    "параграф", "розділ", "ознайоми", "повтори", "підготува", "задач",
)

_STEP_LINE_RE = re.compile(r"^\s*(?:[-•*]|\d+[.)])\s+(.+)$")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def normalize_task_url(url: str) -> str:
    return (url or "").strip()[:512]


def _clean_text(text: Optional[str]) -> str:
    if not text:
        return ""
    return re.sub(r"[ \t]+", " ", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


def compute_task_content_hash(
    title: str,
    description: str = "",
    max_points: Optional[float | int] = None,
) -> str:
    norm_title = re.sub(r"\s+", " ", (title or "").strip()).lower()
    norm_desc = re.sub(r"\s+", " ", (description or "").strip()).lower()
    pts = "" if max_points is None else str(max_points)
    payload = f"{norm_title}\n{norm_desc}\n{pts}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _infer_work_format(combined_lower: str) -> str:
    has_pc = any(kw in combined_lower for kw in _PC_KEYWORDS)
    has_phone = any(kw in combined_lower for kw in _PHONE_KEYWORDS)
    has_form_link = any(kw in combined_lower for kw in ("google form", "forms.gle", "docs.google.com/forms", "гугл форм"))

    if has_form_link and not has_pc:
        return "phone"
    if has_pc:
        return "pc"
    if has_phone:
        return "phone"
    if any(kw in combined_lower for kw in _THEORY_KEYWORDS):
        return "theory"
    return "pc"


def _infer_estimated_minutes(
    work_format: str,
    combined_lower: str,
    desc_len: int,
    max_points: Optional[float | int],
) -> int:
    if work_format == "phone":
        base = 15 if ("тест" in combined_lower or "форм" in combined_lower) else 20
    elif work_format == "theory":
        base = 25
    else:
        base = 40 if ("лаборатор" in combined_lower or "практичн" in combined_lower) else 35

    if desc_len > 500:
        base += 10
    if max_points is not None:
        try:
            pts = float(max_points)
            if pts >= 20:
                base += 15
            elif pts <= 3:
                base = max(10, base - 10)
        except (TypeError, ValueError):
            pass

    return max(10, min(120, int(round(base / 5) * 5)))


def _extract_steps_from_description(description: str) -> list[str]:
    steps: list[str] = []
    for raw_line in description.split("\n"):
        m = _STEP_LINE_RE.match(raw_line)
        if not m:
            continue
        cleaned = _URL_RE.sub("", m.group(1)).strip(" .;-")
        if len(cleaned) >= 4:
            steps.append(cleaned[:120])
        if len(steps) >= 4:
            break
    return steps


def _build_default_steps(work_format: str, has_description: bool) -> list[str]:
    if work_format == "phone":
        return [
            "Відкрити форму або тест у Classroom",
            "Перевірити обмеження часу й надіслати відповіді",
        ]
    if work_format == "theory":
        return [
            "Опрацювати матеріал або конспект за темою",
            "Зафіксувати ключові тези та позначити виконання в Classroom",
        ]
    steps = ["Ознайомитися з умовою та критеріями в Classroom"]
    if has_description:
        steps.append("Виконати практичну частину та перевірити формат файлу")
    else:
        steps.append("Виконати роботу на ПК й прикріпити результат у Classroom")
    return steps


def build_heuristic_task_brief(
    title: str,
    description: str = "",
    max_points: Optional[float | int] = None,
) -> dict[str, Any]:
    """Builds a concise deterministic task brief without external AI calls."""
    clean_title = re.sub(r"\s+", " ", (title or "").strip()) or "Завдання"
    clean_desc = _clean_text(description)
    combined_lower = f"{clean_title}\n{clean_desc}".lower()

    work_format = _infer_work_format(combined_lower)
    estimated_minutes = _infer_estimated_minutes(
        work_format, combined_lower, len(clean_desc), max_points
    )

    steps = _extract_steps_from_description(clean_desc)
    if not steps:
        steps = _build_default_steps(work_format, has_description=len(clean_desc) >= 20)

    summary = ""
    if clean_desc:
        desc_no_urls = _URL_RE.sub("", clean_desc).strip()
        first_chunk = re.split(r"(?<=[.!?])\s+|\n+", desc_no_urls, maxsplit=1)[0].strip()
        if first_chunk and first_chunk.lower() != clean_title.lower():
            summary = first_chunk[:190]
    if not summary:
        format_hint = {
            "phone": "Швидке завдання або тест, зручно виконати з телефона.",
            "theory": "Опрацювання теорії або конспекту до наступної пари.",
            "pc": "Практичне завдання; краще виконувати з комп'ютера.",
        }[work_format]
        summary = f"{clean_title}: {format_hint}"[:200]

    return {
        "summary": summary,
        "steps": steps[:4],
        "estimated_minutes": estimated_minutes,
        "work_format": work_format,
        "source": "heuristic",
    }


def _extract_json_from_gemini_response(data: dict[str, Any]) -> Optional[dict[str, Any]]:
    text_candidates: list[str] = []
    for step in data.get("steps") or []:
        if step.get("type") == "model_output":
            for part in step.get("content") or []:
                if part.get("type") == "text" and isinstance(part.get("text"), str):
                    text_candidates.append(part["text"])
    if not text_candidates and isinstance(data.get("output_text"), str):
        text_candidates.append(data["output_text"])

    for raw_text in text_candidates:
        try:
            parsed = json.loads(raw_text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


def _sanitize_brief_payload(payload: dict[str, Any], source: str) -> Optional[dict[str, Any]]:
    raw_summary = str(payload.get("summary") or "").strip()
    if not raw_summary:
        return None
    summary = re.sub(r"\s+", " ", raw_summary)[:220]

    raw_steps = payload.get("steps")
    steps: list[str] = []
    if isinstance(raw_steps, list):
        for item in raw_steps:
            clean_step = re.sub(r"\s+", " ", str(item or "")).strip()
            if clean_step:
                steps.append(clean_step[:120])
            if len(steps) >= 4:
                break

    work_format = str(payload.get("work_format") or "pc").strip().lower()
    if work_format not in VALID_WORK_FORMATS:
        work_format = "pc"

    est_raw = payload.get("estimated_minutes")
    estimated_minutes: Optional[int] = None
    if est_raw is not None:
        try:
            est_val = int(round(float(est_raw)))
            estimated_minutes = max(5, min(240, est_val))
        except (TypeError, ValueError):
            estimated_minutes = None

    return {
        "summary": summary,
        "steps": steps,
        "estimated_minutes": estimated_minutes,
        "work_format": work_format,
        "source": source,
    }


async def _extract_brief_via_gemini(
    title: str,
    description: str,
    max_points: Optional[float | int] = None,
) -> Optional[dict[str, Any]]:
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key or len((description or "").strip()) < 20:
        return None

    model_name = (settings.gemini_model or "gemini-3.8-flash").strip()
    pts_line = f"\nМаксимум балів: {max_points}" if max_points is not None else ""
    prompt = (
        "Ти допомагаєш студенту українського коледжу швидко зрозуміти завдання з Google Classroom.\n"
        "Проаналізуй назву й опис завдання та поверни стислий JSON українською мовою.\n"
        "- summary: 1 конкретне речення — що саме треба зробити і здати (без води, до 180 символів).\n"
        "- steps: 2–4 короткі практичні кроки.\n"
        "- estimated_minutes: реалістична оцінка часу в хвилинах (від 10 до 180).\n"
        "- work_format: 'phone' (тест, форма, читання, коротка відповідь з телефона), "
        "'pc' (код, звіт, схема, презентація, робота з файлами на ПК), або "
        "'theory' (конспект, параграф, підготовка теорії).\n\n"
        f"Назва: {title.strip()}{pts_line}\n"
        f"Опис:\n{description.strip()[:2500]}"
    )

    body = {
        "model": model_name,
        "input": prompt,
        "response_format": {
            "type": "text",
            "mime_type": "application/json",
            "schema": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "steps": {"type": "array", "items": {"type": "string"}},
                    "estimated_minutes": {"type": "integer"},
                    "work_format": {"type": "string", "enum": ["phone", "pc", "theory"]},
                },
                "required": ["summary", "steps", "estimated_minutes", "work_format"],
            },
        },
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                GEMINI_INTERACTIONS_URL,
                headers={
                    "x-goog-api-key": api_key,
                    "Content-Type": "application/json",
                    "Api-Revision": GEMINI_API_REVISION,
                },
                json=body,
            )
        if resp.status_code != 200:
            logger.warning("Gemini task brief API returned status %s", resp.status_code)
            return None
        parsed = _extract_json_from_gemini_response(resp.json())
        if not parsed:
            return None
        return _sanitize_brief_payload(parsed, source="gemini")
    except Exception as exc:
        logger.debug("Gemini task brief fallback triggered: %s", exc)
        return None


def _row_to_brief_dict(row: ClassroomTaskBrief) -> dict[str, Any]:
    try:
        steps = json.loads(row.steps_json or "[]")
        if not isinstance(steps, list):
            steps = []
    except json.JSONDecodeError:
        steps = []
    return {
        "summary": row.summary,
        "steps": [str(s) for s in steps[:4] if s],
        "estimated_minutes": row.estimated_minutes,
        "work_format": row.work_format if row.work_format in VALID_WORK_FORMATS else "pc",
        "source": row.source or "heuristic",
    }


async def ensure_and_attach_task_briefs(
    db: AsyncSession,
    group_id: int,
    tasks: list[dict[str, Any]],
    descriptions_by_url: Optional[dict[str, str]] = None,
    max_llm_calls: int = 8,
) -> list[dict[str, Any]]:
    """
    Ensures group task briefs are cached in `classroom_task_briefs` (using Gemini when
    configured and description is meaningful, otherwise deterministic heuristics) and
    attaches `brief` onto each task dict.
    """
    if not tasks:
        return tasks

    desc_map = descriptions_by_url or {}
    urls = [
        normalize_task_url(t.get("url") or t.get("alternate_link") or "")
        for t in tasks
    ]
    unique_urls = [u for u in dict.fromkeys(urls) if u]
    if not unique_urls:
        return tasks

    existing_rows = (
        await db.scalars(
            select(ClassroomTaskBrief).where(
                ClassroomTaskBrief.group_id == group_id,
                ClassroomTaskBrief.task_url.in_(unique_urls),
            )
        )
    ).all()
    rows_by_url: dict[str, ClassroomTaskBrief] = {r.task_url: r for r in existing_rows}

    has_gemini = bool((settings.gemini_api_key or "").strip())
    llm_calls_used = 0
    now_utc = datetime.now(timezone.utc)

    for task in tasks:
        raw_url = task.get("url") or task.get("alternate_link") or ""
        norm_url = normalize_task_url(raw_url)
        if not norm_url:
            continue

        title = str(task.get("title") or "").strip() or "Завдання"
        description = _clean_text(desc_map.get(raw_url) or desc_map.get(norm_url) or "")
        max_points = task.get("max_points") if "max_points" in task else task.get("maxPoints")
        content_hash = compute_task_content_hash(title, description, max_points)

        cached = rows_by_url.get(norm_url)
        should_upgrade_to_gemini = (
            cached is not None
            and has_gemini
            and cached.source != "gemini"
            and len(description) >= 20
        )
        needs_refresh = (
            cached is None
            or (description and cached.content_hash != content_hash)
            or should_upgrade_to_gemini
        )

        if needs_refresh:
            brief_data: Optional[dict[str, Any]] = None
            if has_gemini and len(description) >= 20 and llm_calls_used < max_llm_calls:
                llm_calls_used += 1
                brief_data = await _extract_brief_via_gemini(title, description, max_points)

            if brief_data is None:
                brief_data = build_heuristic_task_brief(title, description, max_points)

            if cached is None:
                cached = ClassroomTaskBrief(
                    group_id=group_id,
                    task_url=norm_url,
                    coursework_id=str(task.get("id") or "")[:128] or None,
                    content_hash=content_hash,
                    summary=brief_data["summary"],
                    steps_json=json.dumps(brief_data["steps"], ensure_ascii=False),
                    estimated_minutes=brief_data["estimated_minutes"],
                    work_format=brief_data["work_format"],
                    source=brief_data["source"],
                    updated_at=now_utc,
                )
                db.add(cached)
                rows_by_url[norm_url] = cached
            else:
                cached.coursework_id = str(task.get("id") or "")[:128] or cached.coursework_id
                cached.content_hash = content_hash
                cached.summary = brief_data["summary"]
                cached.steps_json = json.dumps(brief_data["steps"], ensure_ascii=False)
                cached.estimated_minutes = brief_data["estimated_minutes"]
                cached.work_format = brief_data["work_format"]
                cached.source = brief_data["source"]
                cached.updated_at = now_utc

        if cached is not None:
            task["brief"] = _row_to_brief_dict(cached)

    await db.flush()
    return tasks


async def attach_cached_briefs(
    db: AsyncSession,
    group_id: int,
    tasks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Read-only enrichment: attaches cached DB briefs (or lightweight heuristic fallback) onto tasks."""
    if not tasks:
        return tasks

    urls = [
        normalize_task_url(t.get("url") or t.get("alternate_link") or "")
        for t in tasks
    ]
    unique_urls = [u for u in dict.fromkeys(urls) if u]
    rows_by_url: dict[str, ClassroomTaskBrief] = {}
    if unique_urls:
        rows = (
            await db.scalars(
                select(ClassroomTaskBrief).where(
                    ClassroomTaskBrief.group_id == group_id,
                    ClassroomTaskBrief.task_url.in_(unique_urls),
                )
            )
        ).all()
        rows_by_url = {r.task_url: r for r in rows}

    for task in tasks:
        norm_url = normalize_task_url(task.get("url") or task.get("alternate_link") or "")
        cached = rows_by_url.get(norm_url) if norm_url else None
        if cached is not None:
            task["brief"] = _row_to_brief_dict(cached)
        elif not task.get("brief"):
            title = str(task.get("title") or "").strip() or "Завдання"
            max_points = task.get("max_points") if "max_points" in task else task.get("maxPoints")
            task["brief"] = build_heuristic_task_brief(title, "", max_points)

    return tasks
