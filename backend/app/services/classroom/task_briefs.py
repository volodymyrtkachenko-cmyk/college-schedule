"""Cached task brief extraction (honest heuristics + prioritized Gemini API) with clickable materials."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import date, datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.time import KYIV_TZ
from app.models import ClassroomTaskBrief

logger = logging.getLogger("app")

GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
GEMINI_API_REVISION = "2026-05-20"
VALID_WORK_FORMATS = {"phone", "pc", "theory"}
VALID_MATERIAL_KINDS = {"pdf", "doc", "sheet", "slide", "form", "video", "link", "file"}
MIN_GEMINI_DESCRIPTION_CHARS = 20

SUMMARY_MAX_CHARS = 700
HEURISTIC_SUMMARY_MAX_CHARS = 450
DELIVERABLE_MAX_CHARS = 300
STEP_MAX_CHARS = 200
MATERIAL_TITLE_MAX_CHARS = 180
_TERMINAL_PUNCT_CHARS = ".!?»\"')…"

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


def _smart_trim_text(text: Optional[str], max_len: int) -> str:
    """Normalizes whitespace and caps text at a sentence or word boundary without cutting mid-word."""
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if len(cleaned) <= max_len:
        return cleaned

    head = cleaned[: max_len + 1]
    min_sentence_idx = max(24, int(max_len * 0.45))
    best_sentence_end = -1
    for m in re.finditer(r"[.!?…](?:\s|$)", head):
        end_idx = m.start() + 1
        if min_sentence_idx <= end_idx <= max_len:
            best_sentence_end = end_idx
    if best_sentence_end > 0:
        return cleaned[:best_sentence_end].strip()

    limit = max(1, max_len - 1)
    space_idx = cleaned.rfind(" ", 0, limit + 1)
    if space_idx >= max(16, int(max_len * 0.45)):
        return cleaned[:space_idx].rstrip(" ,;:-—–") + "…"
    return cleaned[:limit].rstrip() + "…"


def _looks_truncated_legacy_brief(row: ClassroomTaskBrief) -> bool:
    """Detects previously cached briefs cut mid-word/mid-sentence at the old 160/200/240 limits."""
    clean_sum = (row.summary or "").strip()
    is_gemini = (row.source or "") == "gemini"
    if clean_sum:
        max_old = 240 if is_gemini else 200
        if (max_old - 3) <= len(clean_sum) <= max_old and clean_sum[-1] not in _TERMINAL_PUNCT_CHARS:
            return True

    _, _, deliverable = _decode_steps_payload(row.steps_json)
    if deliverable and 157 <= len(deliverable) <= 160 and deliverable[-1] not in _TERMINAL_PUNCT_CHARS:
        return True

    return False


def _safe_http_url(raw_url: Optional[str]) -> Optional[str]:
    if not raw_url:
        return None
    u = str(raw_url).strip()
    if u.lower().startswith(("https://", "http://")):
        return u[:1024]
    return None


def _infer_drive_kind(title: str, url: Optional[str]) -> str:
    t_low = (title or "").lower()
    u_low = (url or "").lower()
    if t_low.endswith(".pdf") or "/pdf" in u_low:
        return "pdf"
    if "docs.google.com/document" in u_low or t_low.endswith((".doc", ".docx", ".odt", ".rtf")):
        return "doc"
    if "docs.google.com/spreadsheets" in u_low or t_low.endswith((".xls", ".xlsx", ".csv", ".ods")):
        return "sheet"
    if "docs.google.com/presentation" in u_low or t_low.endswith((".ppt", ".pptx", ".odp")):
        return "slide"
    if "docs.google.com/forms" in u_low or "forms.gle/" in u_low:
        return "form"
    return "file"


def extract_coursework_materials(cw: dict[str, Any]) -> list[dict[str, Optional[str]]]:
    """Extracts clickable material items ({title, url, kind}) from Classroom coursework."""
    items: list[dict[str, Optional[str]]] = []
    seen_keys: set[str] = set()

    for mat in cw.get("materials") or []:
        if not isinstance(mat, dict):
            continue
        title = ""
        url: Optional[str] = None
        kind = "file"
        share_mode: Optional[str] = None

        if "driveFile" in mat:
            df = mat["driveFile"] if isinstance(mat["driveFile"], dict) else {}
            inner = df.get("driveFile") if isinstance(df.get("driveFile"), dict) else df
            raw_title = (inner or {}).get("title") or df.get("title") or ""
            title = re.sub(r"\s+", " ", str(raw_title)).strip()
            file_id = (inner or {}).get("id")
            url = _safe_http_url(
                (inner or {}).get("alternateLink")
                or df.get("alternateLink")
                or (f"https://drive.google.com/file/d/{file_id}/view" if file_id else None)
            )
            kind = _infer_drive_kind(title, url)
            if str(df.get("shareMode") or "").upper() == "STUDENT_COPY":
                share_mode = "student_copy"
            if not title:
                title = "Файл Google Drive"
        elif "form" in mat:
            form = mat["form"] if isinstance(mat["form"], dict) else {}
            title = re.sub(r"\s+", " ", str(form.get("title") or "")).strip() or "Google Форма"
            url = _safe_http_url(form.get("formUrl") or form.get("responseUrl"))
            kind = "form"
        elif "youtubeVideo" in mat:
            yt = mat["youtubeVideo"] if isinstance(mat["youtubeVideo"], dict) else {}
            title = re.sub(r"\s+", " ", str(yt.get("title") or "")).strip() or "Відео YouTube"
            yt_id = yt.get("id")
            url = _safe_http_url(
                yt.get("alternateLink")
                or (f"https://www.youtube.com/watch?v={yt_id}" if yt_id else None)
            )
            kind = "video"
        elif "link" in mat:
            link = mat["link"] if isinstance(mat["link"], dict) else {}
            url = _safe_http_url(link.get("url"))
            raw_title = re.sub(r"\s+", " ", str(link.get("title") or "")).strip()
            if raw_title:
                title = raw_title
            elif url:
                host = urlparse(url).hostname or "Посилання"
                title = host.removeprefix("www.")
            else:
                title = "Зовнішнє посилання"
            kind = _infer_drive_kind(title, url)
            if kind == "file":
                kind = "link"
        else:
            continue

        title = _smart_trim_text(title, MATERIAL_TITLE_MAX_CHARS)
        dedup_key = f"{kind}:{url or title.lower()}"
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)
        entry: dict[str, Optional[str]] = {"title": title, "url": url, "kind": kind}
        if share_mode:
            entry["share_mode"] = share_mode
        items.append(entry)
        if len(items) >= 5:
            break

    return items


def _materials_prompt_lines(materials: list[dict[str, Optional[str]]]) -> list[str]:
    kind_labels = {
        "pdf": "PDF",
        "doc": "Документ",
        "sheet": "Таблиця",
        "slide": "Презентація",
        "form": "Google Форма",
        "video": "Відео",
        "link": "Посилання",
        "file": "Файл",
    }
    lines: list[str] = []
    for m in materials:
        title = m.get("title")
        if not title:
            continue
        label = kind_labels.get(m.get("kind") or "file", "Файл")
        suffix = " (видана індивідуальна копія студенту для заповнення)" if m.get("share_mode") == "student_copy" else ""
        lines.append(f"{label}: {title}{suffix}")
    return lines


def compute_task_content_hash(
    title: str,
    description: str = "",
    max_points: Optional[float | int] = None,
    materials: Optional[list[dict[str, Optional[str]]]] = None,
    work_type: str = "",
    subject: str = "",
    topic: str = "",
) -> str:
    # Keep hash strictly anchored to immutable Classroom courseWork content fields so
    # group sync, personal /user-submissions, and background workers always agree on cache hits.
    del subject, topic
    norm_title = re.sub(r"\s+", " ", (title or "").strip()).lower()
    norm_desc = re.sub(r"\s+", " ", (description or "").strip()).lower()
    norm_mats = "|".join(
        f"{(m.get('kind') or '').lower()}:{(m.get('title') or '').strip().lower()}:{(m.get('url') or '').strip()}:{(m.get('share_mode') or '').lower()}"
        for m in (materials or [])
        if isinstance(m, dict) and m.get("title")
    )
    pts = "" if max_points is None else str(max_points)
    payload = (
        f"v5\n{norm_title}\n{norm_desc}\n{norm_mats}\n{work_type.lower()}\n{pts}"
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _infer_work_format(combined_lower: str, work_type: str = "") -> str:
    wt = (work_type or "").upper()
    if wt == "MULTIPLE_CHOICE_QUESTION":
        return "phone"
    has_pc = any(kw in combined_lower for kw in _PC_KEYWORDS)
    has_phone = any(kw in combined_lower for kw in _PHONE_KEYWORDS)
    has_form_link = any(
        kw in combined_lower
        for kw in ("google form", "google форма", "forms.gle", "docs.google.com/forms", "гугл форм")
    )

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
            steps.append(_smart_trim_text(cleaned, STEP_MAX_CHARS))
        if len(steps) >= 4:
            break
    return steps


def _public_material_items(materials: Optional[list[dict[str, Optional[str]]]]) -> list[dict[str, Optional[str]]]:
    cleaned: list[dict[str, Optional[str]]] = []
    for m in (materials or []):
        if not isinstance(m, dict) or not m.get("title"):
            continue
        kind = str(m.get("kind") or "file").strip().lower()
        if kind not in VALID_MATERIAL_KINDS:
            kind = "file"
        cleaned.append({
            "title": _smart_trim_text(str(m["title"]), MATERIAL_TITLE_MAX_CHARS),
            "url": _safe_http_url(m.get("url")),
            "kind": kind,
        })
        if len(cleaned) >= 5:
            break
    return cleaned


def build_heuristic_task_brief(
    title: str,
    description: str = "",
    max_points: Optional[float | int] = None,
    materials: Optional[list[dict[str, Optional[str]]]] = None,
    work_type: str = "",
) -> dict[str, Any]:
    """
    Builds an honest deterministic brief strictly from actual description/materials.
    Never invents random minutes or generic boilerplate when details are absent.
    """
    clean_title = re.sub(r"\s+", " ", (title or "").strip()) or "Завдання"
    clean_desc = _clean_text(description)
    raw_mats = [m for m in (materials or []) if isinstance(m, dict) and m.get("title")][:5]
    mat_list = _public_material_items(raw_mats)
    mat_text = " ".join(m.get("title") or "" for m in mat_list)
    combined_lower = f"{clean_title}\n{clean_desc}\n{mat_text}".lower()

    work_format = _infer_work_format(combined_lower, work_type=work_type)
    estimated_minutes = _extract_explicit_minutes(f"{clean_title}\n{clean_desc}")
    steps = _extract_steps_from_description(clean_desc)

    summary = ""
    if clean_desc:
        desc_no_urls = _URL_RE.sub("", clean_desc).strip()
        non_step_lines = [
            ln.strip()
            for ln in desc_no_urls.split("\n")
            if ln.strip() and not _STEP_LINE_RE.match(ln)
        ]
        candidate = " ".join(non_step_lines) or desc_no_urls
        first_chunk = re.split(r"(?<=[.!?])\s+", candidate, maxsplit=1)[0].strip()
        if first_chunk and first_chunk.lower() != clean_title.lower() and len(first_chunk) >= 8:
            summary = _smart_trim_text(first_chunk, HEURISTIC_SUMMARY_MAX_CHARS)

    deliverable: Optional[str] = None
    if any(m.get("kind") == "form" for m in raw_mats):
        deliverable = "Заповнити та надіслати Google Форму"
    elif any(m.get("share_mode") == "student_copy" for m in raw_mats):
        deliverable = "Заповнити видану копію документа та здати в Classroom"

    return {
        "summary": summary,
        "deliverable": deliverable,
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
    materials: Optional[list[dict[str, Optional[str]]]] = None,
) -> Optional[dict[str, Any]]:
    raw_summary = str(payload.get("summary") or "").strip()
    if not raw_summary:
        return None
    summary = _smart_trim_text(raw_summary, SUMMARY_MAX_CHARS)

    raw_deliv = payload.get("deliverable")
    deliverable: Optional[str] = None
    if isinstance(raw_deliv, str):
        clean_deliv = re.sub(r"\s+", " ", raw_deliv).strip()
        if clean_deliv and clean_deliv.lower() not in ("null", "none", "невідомо", "здати в classroom"):
            deliverable = _smart_trim_text(clean_deliv, DELIVERABLE_MAX_CHARS)

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
        "deliverable": deliverable,
        "steps": [],
        "materials": _public_material_items(materials),
        "estimated_minutes": estimated_minutes,
        "work_format": work_format,
        "source": source,
    }


async def _extract_brief_via_gemini(
    title: str,
    description: str,
    max_points: Optional[float | int] = None,
    materials: Optional[list[dict[str, Optional[str]]]] = None,
    work_type: str = "",
    subject: str = "",
    topic: str = "",
) -> Optional[dict[str, Any]]:
    api_key = (settings.gemini_api_key or "").strip()
    raw_mats = [m for m in (materials or []) if isinstance(m, dict) and m.get("title")]
    clean_desc = (description or "").strip()
    # Never burn LLM calls or fabricate briefs when there is no real description text,
    # because Classroom OAuth intentionally excludes drive.readonly (AI cannot read Drive file contents).
    if not api_key or len(clean_desc) < MIN_GEMINI_DESCRIPTION_CHARS:
        return None

    primary_model = (settings.gemini_model or "gemini-3.5-flash-lite").strip()
    candidate_models = [primary_model]
    if primary_model != "gemini-3.5-flash-lite":
        candidate_models.append("gemini-3.5-flash-lite")

    subj_line = f"\nПредмет: {subject.strip()}" if subject and subject.strip() else ""
    topic_line = f"\nТема курсу: {topic.strip()}" if topic and topic.strip() else ""
    pts_line = f"\nМаксимум балів: {max_points}" if max_points is not None else ""
    type_line = f"\nТип у Classroom: {work_type}" if work_type else ""
    prompt_mats = _materials_prompt_lines(raw_mats)
    mats_line = "\nПрикріплені матеріали (доступні лише назви й типи, без вмісту):\n- " + "\n- ".join(prompt_mats) if prompt_mats else ""
    desc_block = f"\nОпис завдання:\n{clean_desc[:2500]}"

    prompt = (
        "Ти допомагаєш студенту коледжу швидко зрозуміти завдання з Google Classroom.\n"
        "Пиши живою, простою українською без канцеляризмів і банальностей на кшталт «ознайомтесь із умовою» чи «здайте в Classroom».\n"
        "ВАЖЛИВО: ти НЕ можеш відкривати й читати внутрішній вміст прикріплених файлів (бачиш лише їхні назви та типи). "
        "Спирайся суворо на текст опису, назву предмета, тему й наявні метадані — НІКОЛИ не вигадуй завдань або пунктів, яких немає в тексті.\n"
        "Поверни стислий JSON:\n"
        "- summary: 1–2 закінчені, конкретні речення без обривів слів (зазвичай до ~380 символів), що саме потрібно зробити (не повторюй просто назву).\n"
        "- deliverable: коротко конкретний результат для здачі (напр. «Файл .pkt та звіт зі скріншотами», «Пройдена Google Форма», «Конспект у зошиті»). Якщо з опису/типів це незрозуміло — поверни null.\n"
        "- estimated_minutes: число хвилин (10..180) ТІЛЬКИ якщо обсяг справді очевидний (напр. вказаний час тесту або чітка кількість задач); інакше null — НЕ вигадуй час навмання.\n"
        "- work_format: 'phone' (тест, форма, опитування, читання), 'pc' (код, Packet Tracer, звіт, файл, діаграма), або 'theory' (конспект, параграф).\n\n"
        f"Назва: {title.strip()}{subj_line}{topic_line}{pts_line}{type_line}{mats_line}{desc_block}"
    )

    schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "deliverable": {"type": ["string", "null"]},
            "estimated_minutes": {"type": ["integer", "null"]},
            "work_format": {"type": "string", "enum": ["phone", "pc", "theory"]},
        },
        "required": ["summary", "deliverable", "estimated_minutes", "work_format"],
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
                return _sanitize_brief_payload(parsed, source="gemini", materials=raw_mats)
        return None
    except Exception as exc:
        logger.debug("Gemini task brief fallback triggered: %s", exc)
        return None


def _encode_steps_payload(
    steps: list[str],
    materials: list[dict[str, Optional[str]]],
    deliverable: Optional[str] = None,
) -> str:
    if materials or deliverable:
        payload: dict[str, Any] = {"steps": steps, "materials": materials}
        if deliverable:
            payload["deliverable"] = deliverable
        return json.dumps(payload, ensure_ascii=False)
    return json.dumps(steps, ensure_ascii=False)


def _normalize_decoded_material(raw: Any) -> Optional[dict[str, Optional[str]]]:
    if isinstance(raw, dict):
        title = _smart_trim_text(str(raw.get("title") or ""), MATERIAL_TITLE_MAX_CHARS)
        if not title:
            return None
        url = _safe_http_url(raw.get("url"))
        kind = str(raw.get("kind") or "file").strip().lower()
        if kind not in VALID_MATERIAL_KINDS:
            kind = "file"
        return {"title": title, "url": url, "kind": kind}
    if isinstance(raw, str) and raw.strip():
        return {"title": _smart_trim_text(raw, MATERIAL_TITLE_MAX_CHARS), "url": None, "kind": "file"}
    return None


def _decode_steps_payload(
    raw_json: Optional[str],
) -> tuple[list[str], list[dict[str, Optional[str]]], Optional[str]]:
    try:
        parsed = json.loads(raw_json or "[]")
    except json.JSONDecodeError:
        return [], [], None
    if isinstance(parsed, list):
        return [str(s) for s in parsed[:4] if s], [], None
    if isinstance(parsed, dict):
        steps = parsed.get("steps")
        mats = parsed.get("materials")
        clean_steps = [str(s) for s in steps[:4] if s] if isinstance(steps, list) else []
        clean_mats: list[dict[str, Optional[str]]] = []
        if isinstance(mats, list):
            for item in mats[:5]:
                norm = _normalize_decoded_material(item)
                if norm:
                    clean_mats.append(norm)
        raw_deliv = parsed.get("deliverable")
        deliverable = (
            _smart_trim_text(raw_deliv, DELIVERABLE_MAX_CHARS)
            if isinstance(raw_deliv, str) and raw_deliv.strip()
            else None
        )
        return clean_steps, clean_mats, deliverable
    return [], [], None


def _row_to_brief_dict(row: ClassroomTaskBrief) -> dict[str, Any]:
    steps, materials, deliverable = _decode_steps_payload(row.steps_json)
    return {
        "summary": row.summary,
        "deliverable": deliverable,
        "steps": steps,
        "materials": materials,
        "estimated_minutes": row.estimated_minutes,
        "work_format": row.work_format if row.work_format in VALID_WORK_FORMATS else "pc",
        "source": row.source or "heuristic",
    }


def _brief_has_substance(brief: dict[str, Any]) -> bool:
    return bool(
        (brief.get("summary") or "").strip()
        or (brief.get("deliverable") or "").strip()
        or (brief.get("steps") or [])
        or (brief.get("materials") or [])
        or brief.get("source") == "gemini"
    )


def _parse_iso_date(raw_val: Any) -> Optional[date]:
    if isinstance(raw_val, date) and not isinstance(raw_val, datetime):
        return raw_val
    s = str(raw_val or "").strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _parse_ts(raw_val: Any) -> float:
    if isinstance(raw_val, datetime):
        dt = raw_val if raw_val.tzinfo else raw_val.replace(tzinfo=KYIV_TZ)
        return dt.timestamp()
    s = str(raw_val or "").strip()
    if not s:
        return 0.0
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=KYIV_TZ)
        return dt.timestamp()
    except ValueError:
        return 0.0


def _task_ai_priority_key(task: dict[str, Any], ref_today: date) -> tuple[int, int, float]:
    """
    Orders tasks from most immediately useful for AI extraction down to archive:
      Tier 0: Unsubmitted with upcoming/today due_date (nearest deadline first).
      Tier 1: Unsubmitted without due_date OR recently due/created (<=14d overdue or <=21d old; newest first).
      Tier 2: Old overdue unsubmitted tasks (>14d overdue & >21d old; newest first).
      Tier 3: Already turned-in / returned tasks (newest first, only if LLM budget remains).
    """
    is_done = str(task.get("state") or "").upper() in ("TURNED_IN", "RETURNED")
    due = _parse_iso_date(task.get("due_date"))
    created_ts = _parse_ts(task.get("creation_time") or task.get("created_at"))
    due_ts = (
        datetime.combine(due, datetime.min.time(), tzinfo=KYIV_TZ).timestamp()
        if due is not None
        else 0.0
    )
    activity_ts = created_ts or due_ts
    ref_today_ts = datetime.combine(ref_today, datetime.min.time(), tzinfo=KYIV_TZ).timestamp()

    if is_done:
        return (3, 0, -activity_ts)

    if due is not None and due >= ref_today:
        return (0, (due - ref_today).days, -activity_ts)

    recently_due = due is not None and (ref_today - due).days <= 14
    recently_created = created_ts > 0 and (ref_today_ts - created_ts) <= 21 * 86_400
    if due is None or recently_due or recently_created:
        return (1, 0, -activity_ts)

    return (2, 0, -activity_ts)


async def ensure_and_attach_task_briefs(
    db: AsyncSession,
    group_id: int,
    tasks: list[dict[str, Any]],
    descriptions_by_url: Optional[dict[str, str]] = None,
    materials_by_url: Optional[dict[str, list[dict[str, Optional[str]]]]] = None,
    work_types_by_url: Optional[dict[str, str]] = None,
    topics_by_url: Optional[dict[str, str]] = None,
    max_llm_calls: int = 12,
    today: Optional[date] = None,
) -> list[dict[str, Any]]:
    """
    Ensures group task briefs are cached in `classroom_task_briefs` (prioritizing upcoming
    and recent unsubmitted tasks with real text descriptions for Gemini extraction) and attaches
    `brief` onto tasks that have real substance or attached materials.
    """
    if not tasks:
        return tasks

    desc_map = descriptions_by_url or {}
    mat_map = materials_by_url or {}
    wt_map = work_types_by_url or {}
    topic_map = topics_by_url or {}

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
    ref_today = today or datetime.now(KYIV_TZ).date()

    ordered_tasks = sorted(tasks, key=lambda t: _task_ai_priority_key(t, ref_today))
    llm_candidates: list[
        tuple[dict[str, Any], str, str, str, list[dict[str, Optional[str]]], str, Optional[float | int], str, str, str]
    ] = []
    seen_refresh_urls: set[str] = set()

    for task in ordered_tasks:
        raw_url = task.get("url") or task.get("alternate_link") or ""
        norm_url = normalize_task_url(raw_url)
        if not norm_url or norm_url in seen_refresh_urls:
            continue

        title = str(task.get("title") or "").strip() or "Завдання"
        subject = str(task.get("subject") or task.get("course_name") or "").strip()
        topic = _clean_text(topic_map.get(raw_url) or topic_map.get(norm_url) or "")
        description = _clean_text(desc_map.get(raw_url) or desc_map.get(norm_url) or "")
        materials = mat_map.get(raw_url) or mat_map.get(norm_url) or []
        work_type = wt_map.get(raw_url) or wt_map.get(norm_url) or ""
        max_points = task.get("max_points") if "max_points" in task else task.get("maxPoints")
        has_rich_description = len(description) >= MIN_GEMINI_DESCRIPTION_CHARS
        has_context = has_rich_description or len(materials) > 0
        content_hash = compute_task_content_hash(
            title,
            description,
            max_points,
            materials=materials,
            work_type=work_type,
            subject=subject,
            topic=topic,
        )

        cached = rows_by_url.get(norm_url)
        should_upgrade_to_gemini = (
            cached is not None
            and has_gemini
            and cached.source != "gemini"
            and has_rich_description
        )
        should_downgrade_empty_ai = (
            cached is not None
            and cached.source == "gemini"
            and not has_rich_description
        )
        should_repair_truncated = (
            cached is not None
            and has_context
            and _looks_truncated_legacy_brief(cached)
        )
        needs_refresh = (
            cached is None
            or (has_context and cached.content_hash != content_hash)
            or should_upgrade_to_gemini
            or should_downgrade_empty_ai
            or should_repair_truncated
        )

        if needs_refresh:
            seen_refresh_urls.add(norm_url)
            llm_candidates.append(
                (task, norm_url, title, description, materials, work_type, max_points, content_hash, subject, topic)
            )

    gemini_results: dict[str, Optional[dict[str, Any]]] = {}
    if has_gemini and max_llm_calls > 0:
        eligible = [
            c for c in llm_candidates
            if len(c[3]) >= MIN_GEMINI_DESCRIPTION_CHARS
        ][:max_llm_calls]
        if eligible:
            sem = asyncio.Semaphore(4)

            async def _run_one(cand):
                _, n_url, t_title, t_desc, t_mats, t_wt, t_pts, _, t_subj, t_topic = cand
                async with sem:
                    return n_url, await _extract_brief_via_gemini(
                        t_title,
                        t_desc,
                        t_pts,
                        materials=t_mats,
                        work_type=t_wt,
                        subject=t_subj,
                        topic=t_topic,
                    )

            pairs = await asyncio.gather(*(_run_one(c) for c in eligible))
            for n_url, res in pairs:
                gemini_results[n_url] = res

    for _, norm_url, title, description, materials, work_type, max_points, content_hash, _, _ in llm_candidates:
        cached = rows_by_url.get(norm_url)
        brief_data = gemini_results.get(norm_url)
        if brief_data is None:
            if (
                cached is not None
                and cached.source == "gemini"
                and cached.content_hash == content_hash
                and len(description) >= MIN_GEMINI_DESCRIPTION_CHARS
            ):
                # Preserve existing Gemini brief when LLM budget/rate-limit deferred repair to next sync
                continue
            brief_data = build_heuristic_task_brief(
                title, description, max_points, materials=materials, work_type=work_type
            )

        encoded_steps = _encode_steps_payload(
            brief_data["steps"],
            brief_data["materials"],
            deliverable=brief_data.get("deliverable"),
        )
        cached = rows_by_url.get(norm_url)
        if cached is None:
            cached = ClassroomTaskBrief(
                group_id=group_id,
                task_url=norm_url,
                coursework_id=None,
                content_hash=content_hash,
                summary=brief_data["summary"],
                steps_json=encoded_steps,
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
            cached.steps_json = encoded_steps
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
