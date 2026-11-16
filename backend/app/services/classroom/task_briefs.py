"""Cached task brief extraction (honest heuristics + optional Gemini API)."""

from __future__ import annotations

import asyncio
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
    ".docx", ".xlsx", ".pptx",
)
_PHONE_KEYWORDS = (
    "тест", "опитуван", "вікторин", "гугл форм", "google form", "forms.gle",
    "docs.google.com/forms", "quiz", "kahoot", "відповісти на питання",
    "обрати варіант", "пройти тест",
)
_THEORY_KEYWORDS = (
    "конспект", "лекці", "прочита", "опрацюва", "вивчи", "підручник", "теорі",
    "параграф", "розділ", "ознайоми", "повтори", "підготува", "задач",
)

_STEP_LINE_RE = re.compile(r"^\s*(?:[-•*]|\d+[.)])\s+(.+)$")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_EXPLICIT_MINUTES_RE = re.compile(r"\b(\d{1,3})\s*(?:хв|хвилин|min|мин)\b", re.IGNORECASE)


def normalize_task_url(url: str) -> str:
    return (url or "").strip()[:512]


def _clean_text(text: Optional[str]) -> str:
    if not text:
        return ""
    return re.sub(r"[ \t]+", " ", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


def extract_coursework_materials(cw: dict[str, Any]) -> list[str]:
    """Extracts human-readable labels for Classroom coursework attachments."""
    labels: list[str] = []
    for mat in cw.get("materials") or []:
        if not isinstance(mat, dict):
            continue
        if "driveFile" in mat:
            df = mat["driveFile"]
            inner = df.get("driveFile") if isinstance(df, dict) else None
            title = (inner or {}).get("title") or (df or {}).get("title") or ""
            title = re.sub(r"\s+", " ", str(title)).strip()
            if title:
                labels.append(f"Файл: {title[:100]}")
        elif "form" in mat:
            form = mat["form"] or {}
            title = re.sub(r"\s+", " ", str(form.get("title") or "")).strip()
            labels.append(f"Google Форма: {title[:90]}" if title else "Google Форма")
        elif "link" in mat:
            link = mat["link"] or {}
            title = re.sub(r"\s+", " ", str(link.get("title") or "")).strip()
            if title:
                labels.append(f"Посилання: {title[:90]}")
            else:
                labels.append("Зовнішнє посилання")
        elif "youtubeVideo" in mat:
            yt = mat["youtubeVideo"] or {}
            title = re.sub(r"\s+", " ", str(yt.get("title") or "")).strip()
            labels.append(f"Відео: {title[:90]}" if title else "Відео на YouTube")

    # Deduplicate preserving order
    return list(dict.fromkeys(labels))[:5]


def compute_task_content_hash(
    title: str,
    description: str = "",
    max_points: Optional[float | int] = None,
    materials: Optional[list[str]] = None,
    work_type: str = "",
) -> str:
    norm_title = re.sub(r"\s+", " ", (title or "").strip()).lower()
    norm_desc = re.sub(r"\s+", " ", (description or "").strip()).lower()
    norm_mats = "|".join(m.strip().lower() for m in (materials or []) if m)
    pts = "" if max_points is None else str(max_points)
    payload = f"v2\n{norm_title}\n{norm_desc}\n{norm_mats}\n{work_type.lower()}\n{pts}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _infer_work_format(combined_lower: str, work_type: str = "") -> str:
    wt = (work_type or "").upper()
    if wt == "MULTIPLE_CHOICE_QUESTION":
        return "phone"
    has_pc = any(kw in combined_lower for kw in _PC_KEYWORDS)
    has_phone = any(kw in combined_lower for kw in _PHONE_KEYWORDS)
    has_form_link = any(kw in combined_lower for kw in ("google form", "google форма", "forms.gle", "docs.google.com/forms", "гугл форм"))

    if has_form_link and not has_pc:
        return "phone"
    if has_pc:
        return "pc"
    if has_phone:
        return "phone"
    if wt == "SHORT_ANSWER_QUESTION":
        return "phone"
    if any(kw in combined_lower for kw in _THEORY_KEYWORDS):
        return "theory"
    return "pc"


def _extract_explicit_minutes(text: str) -> Optional[int]:
    m = _EXPLICIT_MINUTES_RE.search(text or "")
    if not m:
        return None
    try:
        val = int(m.group(1))
        if 5 <= val <= 240:
            return val
    except ValueError:
        pass
    return None


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


def build_heuristic_task_brief(
    title: str,
    description: str = "",
    max_points: Optional[float | int] = None,
    materials: Optional[list[str]] = None,
    work_type: str = "",
) -> dict[str, Any]:
    """
    Builds an honest deterministic brief strictly from actual description/materials.
    Never invents fake minutes or generic multi-step boilerplate when details are absent.
    """
    clean_title = re.sub(r"\s+", " ", (title or "").strip()) or "Завдання"
    clean_desc = _clean_text(description)
    mat_list = [str(m).strip() for m in (materials or []) if str(m).strip()][:5]
    combined_lower = f"{clean_title}\n{clean_desc}\n{' '.join(mat_list)}".lower()

    work_format = _infer_work_format(combined_lower, work_type=work_type)
    estimated_minutes = _extract_explicit_minutes(f"{clean_title}\n{clean_desc}")
    steps = _extract_steps_from_description(clean_desc)

    summary = ""
    if clean_desc:
        desc_no_urls = _URL_RE.sub("", clean_desc).strip()
        # Drop lines already captured as bullet steps so summary adds real context
        non_step_lines = [
            ln.strip()
            for ln in desc_no_urls.split("\n")
            if ln.strip() and not _STEP_LINE_RE.match(ln)
        ]
        candidate = " ".join(non_step_lines) or desc_no_urls
        first_chunk = re.split(r"(?<=[.!?])\s+", candidate, maxsplit=1)[0].strip()
        if first_chunk and first_chunk.lower() != clean_title.lower() and len(first_chunk) >= 8:
            summary = first_chunk[:200]

    return {
        "summary": summary,
        "steps": steps[:4],
        "materials": mat_list,
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


def _sanitize_brief_payload(
    payload: dict[str, Any],
    source: str,
    materials: Optional[list[str]] = None,
) -> Optional[dict[str, Any]]:
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
            if 5 <= est_val <= 240:
                estimated_minutes = est_val
        except (TypeError, ValueError):
            estimated_minutes = None

    return {
        "summary": summary,
        "steps": steps,
        "materials": [str(m).strip() for m in (materials or []) if str(m).strip()][:5],
        "estimated_minutes": estimated_minutes,
        "work_format": work_format,
        "source": source,
    }


async def _extract_brief_via_gemini(
    title: str,
    description: str,
    max_points: Optional[float | int] = None,
    materials: Optional[list[str]] = None,
    work_type: str = "",
) -> Optional[dict[str, Any]]:
    api_key = (settings.gemini_api_key or "").strip()
    mat_list = [str(m).strip() for m in (materials or []) if str(m).strip()]
    clean_desc = (description or "").strip()
    if not api_key or (len(clean_desc) < 20 and not mat_list):
        return None

    primary_model = (settings.gemini_model or "gemini-3.5-flash-lite").strip()
    candidate_models = [primary_model]
    if primary_model != "gemini-3.5-flash-lite":
        candidate_models.append("gemini-3.5-flash-lite")

    pts_line = f"\nМаксимум балів: {max_points}" if max_points is not None else ""
    type_line = f"\nТип у Classroom: {work_type}" if work_type else ""
    mats_line = f"\nПрикріплені матеріали:\n- " + "\n- ".join(mat_list) if mat_list else ""
    desc_block = f"\nОпис:\n{clean_desc[:2500]}" if clean_desc else "\nОпис: (відсутній)"

    prompt = (
        "Ти допомагаєш студенту українського коледжу швидко зрозуміти конкретне завдання з Google Classroom.\n"
        "Поверни стислий, конкретний JSON українською мовою без загальних шаблонів і без вигадування фактів.\n"
        "- summary: 1 конкретне речення — що саме треба зробити і здати (до 180 символів). Не повторюй просто назву.\n"
        "- steps: 2–4 конкретні короткі кроки, якщо вони випливають із тексту чи файлів; якщо деталей замало, дай 0–2 чесні кроки.\n"
        "- estimated_minutes: реалістична оцінка часу в хвилинах (10..180) ТІЛЬКИ якщо обсяг зрозумілий із тексту або типу (напр. тест/конспект/конкретна лаба); інакше null — НЕ вигадуй час навмання.\n"
        "- work_format: 'phone' (тест, форма, опитування, читання), 'pc' (код, Packet Tracer, звіт, файл, діаграма), або 'theory' (конспект, параграф).\n\n"
        f"Назва: {title.strip()}{pts_line}{type_line}{mats_line}{desc_block}"
    )

    schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "steps": {"type": "array", "items": {"type": "string"}},
            "estimated_minutes": {"type": ["integer", "null"]},
            "work_format": {"type": "string", "enum": ["phone", "pc", "theory"]},
        },
        "required": ["summary", "steps", "estimated_minutes", "work_format"],
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            for model_name in candidate_models:
                try:
                    resp = await client.post(
                        GEMINI_INTERACTIONS_URL,
                        headers={
                            "x-goog-api-key": api_key,
                            "Content-Type": "application/json",
                            "Api-Revision": GEMINI_API_REVISION,
                        },
                        json={
                            "model": model_name,
                            "input": prompt,
                            "response_format": {
                                "type": "text",
                                "mime_type": "application/json",
                                "schema": schema,
                            },
                        },
                    )
                except httpx.TimeoutException:
                    logger.warning("Gemini model %s timed out, trying fallback", model_name)
                    continue

                if resp.status_code in (404, 429, 503):
                    logger.warning(
                        "Gemini model %s returned status %s, trying fallback",
                        model_name,
                        resp.status_code,
                    )
                    continue
                if resp.status_code != 200:
                    logger.warning("Gemini task brief API returned status %s", resp.status_code)
                    return None
                parsed = _extract_json_from_gemini_response(resp.json())
                if not parsed:
                    return None
                return _sanitize_brief_payload(parsed, source="gemini", materials=mat_list)
        return None
    except Exception as exc:
        logger.debug("Gemini task brief fallback triggered: %s", exc)
        return None


def _encode_steps_payload(steps: list[str], materials: list[str]) -> str:
    if materials:
        return json.dumps({"steps": steps, "materials": materials}, ensure_ascii=False)
    return json.dumps(steps, ensure_ascii=False)


def _decode_steps_payload(raw_json: Optional[str]) -> tuple[list[str], list[str]]:
    try:
        parsed = json.loads(raw_json or "[]")
    except json.JSONDecodeError:
        return [], []
    if isinstance(parsed, list):
        return [str(s) for s in parsed[:4] if s], []
    if isinstance(parsed, dict):
        steps = parsed.get("steps")
        mats = parsed.get("materials")
        clean_steps = [str(s) for s in steps[:4] if s] if isinstance(steps, list) else []
        clean_mats = [str(m) for m in mats[:5] if m] if isinstance(mats, list) else []
        return clean_steps, clean_mats
    return [], []


def _row_to_brief_dict(row: ClassroomTaskBrief) -> dict[str, Any]:
    steps, materials = _decode_steps_payload(row.steps_json)
    return {
        "summary": row.summary,
        "steps": steps,
        "materials": materials,
        "estimated_minutes": row.estimated_minutes,
        "work_format": row.work_format if row.work_format in VALID_WORK_FORMATS else "pc",
        "source": row.source or "heuristic",
    }


def _brief_has_substance(brief: dict[str, Any]) -> bool:
    return bool(
        (brief.get("summary") or "").strip()
        or (brief.get("steps") or [])
        or (brief.get("materials") or [])
        or brief.get("source") == "gemini"
    )


async def ensure_and_attach_task_briefs(
    db: AsyncSession,
    group_id: int,
    tasks: list[dict[str, Any]],
    descriptions_by_url: Optional[dict[str, str]] = None,
    materials_by_url: Optional[dict[str, list[str]]] = None,
    work_types_by_url: Optional[dict[str, str]] = None,
    max_llm_calls: int = 12,
) -> list[dict[str, Any]]:
    """
    Ensures group task briefs are cached in `classroom_task_briefs` (prioritizing active
    unsubmitted tasks for Gemini extraction) and attaches `brief` onto tasks that have real substance.
    """
    if not tasks:
        return tasks

    desc_map = descriptions_by_url or {}
    mat_map = materials_by_url or {}
    wt_map = work_types_by_url or {}

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
    now_utc = datetime.now(timezone.utc)

    # Prioritize active/unsubmitted tasks with due dates so LLM quota never burns on old turned-in tasks
    def _task_priority_key(task: dict[str, Any]) -> tuple[int, str]:
        is_done = str(task.get("state") or "").upper() in ("TURNED_IN", "RETURNED")
        due = str(task.get("due_date") or "9999-12-31")
        return (1 if is_done else 0, due)

    ordered_tasks = sorted(tasks, key=_task_priority_key)
    llm_candidates: list[tuple[dict[str, Any], str, str, list[str], str, Optional[float | int], str]] = []
    seen_refresh_urls: set[str] = set()

    for task in ordered_tasks:
        raw_url = task.get("url") or task.get("alternate_link") or ""
        norm_url = normalize_task_url(raw_url)
        if not norm_url or norm_url in seen_refresh_urls:
            continue

        title = str(task.get("title") or "").strip() or "Завдання"
        description = _clean_text(desc_map.get(raw_url) or desc_map.get(norm_url) or "")
        materials = mat_map.get(raw_url) or mat_map.get(norm_url) or []
        work_type = wt_map.get(raw_url) or wt_map.get(norm_url) or ""
        max_points = task.get("max_points") if "max_points" in task else task.get("maxPoints")
        has_context = len(description) >= 20 or len(materials) > 0
        content_hash = compute_task_content_hash(
            title, description, max_points, materials=materials, work_type=work_type
        )

        cached = rows_by_url.get(norm_url)
        should_upgrade_to_gemini = (
            cached is not None
            and has_gemini
            and cached.source != "gemini"
            and has_context
        )
        needs_refresh = (
            cached is None
            or (has_context and cached.content_hash != content_hash)
            or should_upgrade_to_gemini
        )

        if needs_refresh:
            seen_refresh_urls.add(norm_url)
            llm_candidates.append(
                (task, norm_url, title, description, materials, work_type, max_points, content_hash)
            )

    # Run Gemini extraction concurrently (bounded) for the top candidates with real context
    gemini_results: dict[str, Optional[dict[str, Any]]] = {}
    if has_gemini and max_llm_calls > 0:
        eligible = [
            c for c in llm_candidates
            if len(c[3]) >= 20 or len(c[4]) > 0
        ][:max_llm_calls]
        if eligible:
            sem = asyncio.Semaphore(4)

            async def _run_one(cand):
                _, n_url, t_title, t_desc, t_mats, t_wt, t_pts, _ = cand
                async with sem:
                    return n_url, await _extract_brief_via_gemini(
                        t_title, t_desc, t_pts, materials=t_mats, work_type=t_wt
                    )

            pairs = await asyncio.gather(*(_run_one(c) for c in eligible))
            for n_url, res in pairs:
                gemini_results[n_url] = res

    for _, norm_url, title, description, materials, work_type, max_points, content_hash in llm_candidates:
        brief_data = gemini_results.get(norm_url)
        if brief_data is None:
            brief_data = build_heuristic_task_brief(
                title, description, max_points, materials=materials, work_type=work_type
            )

        cached = rows_by_url.get(norm_url)
        if cached is None:
            cached = ClassroomTaskBrief(
                group_id=group_id,
                task_url=norm_url,
                coursework_id=None,
                content_hash=content_hash,
                summary=brief_data["summary"],
                steps_json=_encode_steps_payload(brief_data["steps"], brief_data["materials"]),
                estimated_minutes=brief_data["estimated_minutes"],
                work_format=brief_data["work_format"],
                source=brief_data["source"],
                updated_at=now_utc,
            )
            db.add(cached)
            rows_by_url[norm_url] = cached
        else:
            cached.content_hash = content_hash
            cached.summary = brief_data["summary"]
            cached.steps_json = _encode_steps_payload(brief_data["steps"], brief_data["materials"])
            cached.estimated_minutes = brief_data["estimated_minutes"]
            cached.work_format = brief_data["work_format"]
            cached.source = brief_data["source"]
            cached.updated_at = now_utc

    for task in tasks:
        norm_url = normalize_task_url(task.get("url") or task.get("alternate_link") or "")
        cached = rows_by_url.get(norm_url) if norm_url else None
        if cached is not None:
            brief_dict = _row_to_brief_dict(cached)
            task["brief"] = brief_dict if _brief_has_substance(brief_dict) else None
        else:
            task["brief"] = None

    await db.flush()
    return tasks


async def attach_cached_briefs(
    db: AsyncSession,
    group_id: int,
    tasks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Read-only enrichment: attaches cached DB briefs when they have genuine substance."""
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
            brief_dict = _row_to_brief_dict(cached)
            task["brief"] = brief_dict if _brief_has_substance(brief_dict) else None
        elif "brief" not in task:
            task["brief"] = None

    return tasks
