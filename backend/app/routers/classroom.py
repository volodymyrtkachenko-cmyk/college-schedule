import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Group
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.projection import build_projection

router = APIRouter(prefix="/api/classroom", tags=["classroom"])
KYIV_TZ = ZoneInfo("Europe/Kyiv")

URL_RE = re.compile(
    r"https?://(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)/[^\s<>\"')|]+",
    re.IGNORECASE,
)
ZOOM_ID_RE = re.compile(
    r"(?:Ідентифікатор(?:\s+конференції)?|Meeting\s*ID)\s*[:\-]?\s*(\d{3}[\s\-\u00a0]?\d{3,4}[\s\-\u00a0]?\d{3,4})",
    re.IGNORECASE,
)
ZOOM_PASS_RE = re.compile(
    r"(?:Код\s+доступ[уа]|Passcode|Пароль)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)",
    re.IGNORECASE,
)
DATE_RE = re.compile(r"(?<![:\d])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![:\d])")
DATE_TEXT_RE = re.compile(
    r"\b(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)\b",
    re.IGNORECASE,
)
TIME_PREFIX_RE = re.compile(r"(?:\bо\s+|\bоб\s+|\bв\s+|\bна\s+)(\d{1,2})[:\-](\d{2})(?!\d)", re.IGNORECASE)
TIME_COLON_RE = re.compile(r"(?<![.\d])(\d{1,2}):(\d{2})(?![.\d])")

UKR_MONTHS = {
    "січ": 1, "лют": 2, "бер": 3, "кві": 4, "тра": 5, "чер": 6,
    "лип": 7, "сер": 8, "вер": 9, "жов": 10, "лис": 11, "гру": 12,
}


class ClassroomSyncRequest(BaseModel):
    access_token: str
    group_id: Optional[int] = None
    week_start: Optional[date] = None


async def ensure_known_online_links(db: AsyncSession) -> None:
    """Порожня заглушка для сумісності імпортів — жодного автозаповнення без постів."""
    return None


def _norm(s: Optional[str]) -> str:
    if not s:
        return ""
    res = s.lower()
    for ch in ("’", "ʼ", "`", "´", "‘"):
        res = res.replace(ch, "'")
    return res.strip()


def _time_to_lesson_number(hour: int, minute: int) -> Optional[int]:
    total = hour * 60 + minute
    bells = [
        (0, 7 * 60 + 30),
        (1, 9 * 60 + 0),
        (2, 10 * 60 + 40),
        (3, 12 * 60 + 30),
        (4, 14 * 60 + 0),
    ]
    for num, start_min in bells:
        if abs(total - start_min) <= 25:
            return num
    return None


def _extract_group_from_course_name(course_name: str, groups: list[Group]) -> Optional[Group]:
    for g in sorted(groups, key=lambda x: len(x.name), reverse=True):
        pattern = rf"(?:^|[\s\-/—_]){re.escape(g.name)}(?:$|[\s\-/—_)])"
        if re.search(pattern, course_name, re.IGNORECASE):
            return g
    return None


def _parse_announcement(text: str, created_dt: datetime, materials: Optional[list] = None) -> Optional[dict]:
    url_match = URL_RE.search(text)
    url = url_match.group(0).rstrip(".,;!") if url_match else None

    if not url and materials:
        for mat in materials:
            link_url = mat.get("link", {}).get("url", "")
            m = URL_RE.search(link_url)
            if m:
                url = m.group(0).rstrip(".,;!")
                break

    zoom_id_match = ZOOM_ID_RE.search(text)
    zoom_pass_match = ZOOM_PASS_RE.search(text)

    zoom_id = re.sub(r"[\s\-\u00a0]", "", zoom_id_match.group(1)) if zoom_id_match else None
    zoom_pass = zoom_pass_match.group(1).rstrip(".,;!") if zoom_pass_match else None

    if not url and zoom_id:
        url = f"https://zoom.us/j/{zoom_id}"
        if zoom_pass:
            url = f"{url}?pwd={zoom_pass}"
    elif url and "zoom.us" in url.lower() and zoom_pass and "pwd=" not in url.lower():
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}pwd={zoom_pass}"

    if not url:
        return None

    text_norm = _norm(text)
    target_date: Optional[date] = None

    for dm in DATE_RE.finditer(text):
        day_s, month_s, year_s = dm.groups()
        d_i, m_i = int(day_s), int(month_s)
        if 1 <= d_i <= 31 and 1 <= m_i <= 12:
            year = int(year_s) if year_s else created_dt.year
            if year < 100:
                year += 2000
            try:
                target_date = date(year, m_i, d_i)
                break
            except ValueError:
                continue

    if target_date is None:
        tdm = DATE_TEXT_RE.search(text_norm)
        if tdm:
            day_s, month_word = tdm.groups()
            m_i = UKR_MONTHS.get(month_word[:3])
            if m_i:
                try:
                    target_date = date(created_dt.year, m_i, int(day_s))
                except ValueError:
                    pass

    if target_date is None:
        if "завтра" in text_norm or created_dt.hour >= 16:
            target_date = created_dt.date() + timedelta(days=1)
        else:
            target_date = created_dt.date()

    lesson_number: Optional[int] = None
    for tm in TIME_PREFIX_RE.finditer(text_norm):
        h, mins = int(tm.group(1)), int(tm.group(2))
        if 7 <= h <= 16 and 0 <= mins <= 59:
            lesson_number = _time_to_lesson_number(h, mins)
            if lesson_number is not None:
                break

    if lesson_number is None:
        for tm in TIME_COLON_RE.finditer(text_norm):
            h, mins = int(tm.group(1)), int(tm.group(2))
            if 7 <= h <= 16 and 0 <= mins <= 59:
                lesson_number = _time_to_lesson_number(h, mins)
                if lesson_number is not None:
                    break

    return {
        "url": url,
        "target_date": target_date,
        "lesson_number": lesson_number,
        "created_dt": created_dt,
        "text_norm": text_norm,
    }


def _matches_teacher_or_subject(ann: dict, lesson) -> bool:
    subj_norm = _norm(lesson.subject_name)
    teacher_norm = _norm(lesson.teacher_name)
    text_norm = ann["text_norm"]
    author_tokens: list[str] = ann.get("author_tokens", [])

    if "виховн" in subj_norm:
        return False

    lesson_surnames = [
        re.sub(r"[^а-яіїєґ']", "", part.split()[0])
        for part in teacher_norm.split("/")
        if part.strip()
    ]
    lesson_surnames = [s for s in lesson_surnames if len(s) >= 3]

    for s in lesson_surnames:
        if any(s in tok or tok in s for tok in author_tokens):
            return True
        if s in text_norm:
            return True

    keywords = [
        ("електронік", ("електронік",)),
        ("схемотехнік", ("схемотехнік",)),
        ("українськ", ("українськ", "мови за пс")),
        ("дизайн", ("дизайн", "web")),
        ("математик", ("математик", "дискретн")),
        ("філософ", ("філософ", "соціолог", "релігієзнав")),
        ("іноземн", ("іноземн", "англ")),
        ("фізичн", ("фізичн", "фізкультур")),
    ]
    for subj_key, text_keys in keywords:
        if subj_key in subj_norm and any(tk in text_norm for tk in text_keys):
            return True

    subj_words = [w for w in re.split(r"[^а-яіїєґa-z']+", subj_norm) if len(w) >= 6]
    if subj_words and any(w[:6] in text_norm for w in subj_words):
        return True

    return False


async def _save_link_to_slot(
    db: AsyncSession,
    target_date: date,
    group_id: int,
    lesson,
    url_line: str,
    matched_prefix: Optional[str] = None,
) -> None:
    note_row = await db.scalar(
        select(LessonOccurrenceNote).where(
            LessonOccurrenceNote.note_date == target_date,
            LessonOccurrenceNote.group_id == group_id,
            LessonOccurrenceNote.lesson_number == lesson.lesson_number,
        )
    )
    if note_row:
        kept_lines = []
        for line in note_row.note.split("\n"):
            l_str = line.strip()
            if not l_str:
                continue
            if URL_RE.search(l_str):
                if matched_prefix and not l_str.startswith(matched_prefix):
                    kept_lines.append(l_str)
            else:
                kept_lines.append(l_str)

        note_row.note = (
            f"{url_line}\n{chr(10).join(kept_lines)}"[:500]
            if kept_lines
            else url_line[:500]
        )
        note_row.subject_id = lesson.subject_id
        note_row.subject_name = lesson.subject_name or note_row.subject_name
        note_row.archived = False
        note_row.revision += 1
        note_row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(
            LessonOccurrenceNote(
                note_date=target_date,
                group_id=group_id,
                lesson_number=lesson.lesson_number,
                subject_id=lesson.subject_id,
                subject_name=lesson.subject_name or "",
                note=url_line[:500],
                revision=1,
                archived=False,
                origin_kind="classroom",
                origin_id=0,
            )
        )


@router.post("/sync")
async def sync_from_classroom(
    payload: ClassroomSyncRequest,
    db: AsyncSession = Depends(get_db),
):
    headers = {"Authorization": f"Bearer {payload.access_token}"}
    all_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()

    async with httpx.AsyncClient(timeout=15.0) as client:
        courses_resp = await client.get(
            "https://classroom.googleapis.com/v1/courses",
            params={"courseStates": "ACTIVE", "pageSize": 30},
            headers=headers,
        )
        if courses_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Не вдалося отримати курси з Google Classroom")

        courses = courses_resp.json().get("courses", [])
        detected_group: Optional[Group] = None
        matched_courses = []

        if payload.group_id:
            detected_group = next((g for g in all_groups if g.id == payload.group_id), None)

        for c in courses:
            full_title = f"{c.get('name', '')} {c.get('section', '')}".strip()
            g = _extract_group_from_course_name(full_title, all_groups)
            if g:
                if not detected_group:
                    detected_group = g
                if detected_group and g.id == detected_group.id:
                    matched_courses.append(c)

        if not detected_group:
            raise HTTPException(
                status_code=404,
                detail="Не знайдено курс вашої групи у Google Classroom (наприклад, КІ-24-2/9-85).",
            )

        if not matched_courses:
            matched_courses = courses[:3]

        # Межі ТІЛЬКИ ПОТОЧНОГО тижня (Понеділок .. П'ятниця)
        today_kyiv = payload.week_start or datetime.now(KYIV_TZ).date()
        week_monday = today_kyiv - timedelta(days=today_kyiv.weekday())
        week_friday = week_monday + timedelta(days=4)

        # КРОК 1: ПОВНІСТЮ ВИДАЛЯЄМО всі старі авто-посилання цієї групи з бази даних (щоб на інших тижнях і днях без постів стояла лише аудиторія)
        all_group_notes = (
            await db.scalars(
                select(LessonOccurrenceNote).where(
                    LessonOccurrenceNote.group_id == detected_group.id
                )
            )
        ).all()

        for gn in all_group_notes:
            user_only = [
                line.strip()
                for line in gn.note.split("\n")
                if line.strip()
                and not URL_RE.search(line)
                and not re.search(r"(?:Код|ID|Passcode|Пароль)\s*:", line, re.IGNORECASE)
            ]
            if user_only:
                gn.note = "\n".join(user_only)
                gn.revision += 1
                gn.updated_at = datetime.now(timezone.utc)
            else:
                await db.delete(gn)

        await db.flush()

        # КРОК 2: Збираємо оголошення зі стрічки Classroom
        parsed_announcements: list[dict] = []

        for course in matched_courses:
            course_id = course["id"]
            teacher_tokens_by_uid: dict[str, list[str]] = {}

            t_resp = await client.get(
                f"https://classroom.googleapis.com/v1/courses/{course_id}/teachers",
                headers=headers,
            )
            if t_resp.status_code == 200:
                for t_item in t_resp.json().get("teachers", []):
                    uid = t_item.get("userId")
                    fn = _norm(t_item.get("profile", {}).get("name", {}).get("fullName", ""))
                    if uid and fn:
                        teacher_tokens_by_uid[uid] = [w for w in fn.split() if len(w) >= 3]

            ann_resp = await client.get(
                f"https://classroom.googleapis.com/v1/courses/{course_id}/announcements",
                params={"pageSize": 50},
                headers=headers,
            )
            if ann_resp.status_code != 200:
                continue

            for ann in ann_resp.json().get("announcements", []):
                text = ann.get("text", "")
                if not text:
                    continue

                created_raw = ann.get("creationTime") or ann.get("updateTime")
                created_dt = (
                    datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(KYIV_TZ)
                    if created_raw
                    else datetime.now(KYIV_TZ)
                )

                parsed = _parse_announcement(text, created_dt, ann.get("materials"))
                if not parsed:
                    continue

                creator_id = ann.get("creatorUserId", "")
                author_tokens = teacher_tokens_by_uid.get(creator_id, [])
                if creator_id and not author_tokens and creator_id not in teacher_tokens_by_uid:
                    prof_resp = await client.get(
                        f"https://classroom.googleapis.com/v1/courses/{course_id}/teachers/{creator_id}",
                        headers=headers,
                    )
                    if prof_resp.status_code == 200:
                        fn = _norm(prof_resp.json().get("profile", {}).get("name", {}).get("fullName", ""))
                        author_tokens = [w for w in fn.split() if len(w) >= 3]
                    teacher_tokens_by_uid[creator_id] = author_tokens

                parsed["author_tokens"] = author_tokens
                parsed_announcements.append(parsed)

        # Завантажуємо розклад ЛИШЕ на 5 днів поточного тижня (week_monday .. week_friday)
        week_days_lessons: dict[date, list] = {}
        for i in range(5):
            d = week_monday + timedelta(days=i)
            proj_res = await build_projection(db, d, group_id=detected_group.id)
            raw_list = proj_res[1] if isinstance(proj_res, tuple) else proj_res
            week_days_lessons[d] = [
                l for l in (raw_list or [])
                if l.subject_id and (1 <= l.lesson_number <= 4)
            ]

        # КРОК 3: Ставимо посилання ВИКЛЮЧНО на ту дату і ту пару поточного тижня, де є реальний пост!
        # Якщо на пару немає поста на цей день — залишається просто номер аудиторії.
        parsed_announcements.sort(key=lambda x: x["created_dt"])
        synced_links = 0

        for pa in parsed_announcements:
            target_date: date = pa["target_date"]
            if not (week_monday <= target_date <= week_friday):
                continue

            day_lessons = week_days_lessons.get(target_date, [])
            if not day_lessons:
                continue

            candidates = [l for l in day_lessons if _matches_teacher_or_subject(pa, l)]
            matched_lesson = None

            if pa["lesson_number"] is not None:
                matched_lesson = next(
                    (l for l in candidates if l.lesson_number == pa["lesson_number"]),
                    None,
                )
                if not matched_lesson and not candidates:
                    matched_lesson = next(
                        (l for l in day_lessons if l.lesson_number == pa["lesson_number"]),
                        None,
                    )
            elif len(candidates) == 1:
                matched_lesson = candidates[0]

            if not matched_lesson:
                continue

            url_line = pa["url"]
            teacher_parts = [p.strip() for p in (matched_lesson.teacher_name or "").split("/") if p.strip()]
            matched_prefix = None
            if len(teacher_parts) > 1:
                for tp in teacher_parts:
                    tp_norm = _norm(tp)
                    if any(tok in tp_norm for tok in pa.get("author_tokens", [])) or _norm(tp.split()[0]) in pa["text_norm"]:
                        matched_prefix = tp.split()[0]
                        break
            if matched_prefix:
                url_line = f"{matched_prefix}: {url_line}"

            await _save_link_to_slot(
                db, target_date, detected_group.id, matched_lesson, url_line, matched_prefix
            )
            synced_links += 1

        await db.commit()

    return {
        "group_id": detected_group.id,
        "group_name": detected_group.name,
        "synced_links": synced_links,
    }
