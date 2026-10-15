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
from app.models import Group, Schedule, Subject, Teacher
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.projection import build_projection

router = APIRouter(prefix="/api/classroom", tags=["classroom"])
KYIV_TZ = ZoneInfo("Europe/Kyiv")

# 1. Виправлені регулярні вирази (коректно ловлять "о 10:40," з комою та ID Zoom з пробілами):
URL_RE = re.compile(
    r"https?://(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)/[^\s<>\"')]+",
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
DATE_RE = re.compile(r"\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b")
TIME_RE = re.compile(r"(?:о\s+|в\s+|на\s+|\b)(\d{1,2})[:\-](\d{2})(?!\d)", re.IGNORECASE)
QUOTED_SUBJECT_RE = re.compile(r"[\"«„]([^\"»“]{4,80})[\"»“]")


class ClassroomSyncRequest(BaseModel):
    access_token: str
    group_id: Optional[int] = None


def _time_to_lesson_number(hour: int, minute: int) -> Optional[int]:
    """Перетворює час із поста (напр. 09:03, 10:40, 12-30) на номер пари (0..4)."""
    total = hour * 60 + minute
    bells = [
        (0, 7 * 60 + 30),   # 07:30
        (1, 9 * 60 + 0),    # 09:00
        (2, 10 * 60 + 40),  # 10:40
        (3, 12 * 60 + 30),  # 12:30
        (4, 14 * 60 + 0),   # 14:00
    ]
    for num, start_min in bells:
        if abs(total - start_min) <= 25:
            return num
    return None


def _extract_group_from_course_name(course_name: str, groups: list[Group]) -> Optional[Group]:
    """Знаходить групу '85' у назві курсу 'КІ-24-2/9-85' або 'Група 85'."""
    for g in sorted(groups, key=lambda x: len(x.name), reverse=True):
        pattern = rf"(?:^|[\s\-/—_]){re.escape(g.name)}(?:$|[\s\-/—_)])"
        if re.search(pattern, course_name, re.IGNORECASE):
            return g
    return None


def _parse_announcement(text: str, created_dt: datetime) -> dict:
    """Витягує з тексту оголошення дату пари, номер пари, лінк Meet/Zoom, ID та код доступу."""
    url_match = URL_RE.search(text)
    zoom_id_match = ZOOM_ID_RE.search(text)
    zoom_pass_match = ZOOM_PASS_RE.search(text)

    url = url_match.group(0) if url_match else None
    zoom_id = re.sub(r"[\s\-\u00a0]", "", zoom_id_match.group(1)) if zoom_id_match else None
    zoom_pass = zoom_pass_match.group(1) if zoom_pass_match else None

    if not url and zoom_id:
        url = f"https://zoom.us/j/{zoom_id}"

    # 1. Визначаємо дату проведення пари
    target_date = created_dt.date()
    lower_text = text.lower()
    date_match = DATE_RE.search(text)
    has_explicit_date_or_today = False

    if date_match:
        day_s, month_s, year_s = date_match.groups()
        year = int(year_s) if year_s else created_dt.year
        if year < 100:
            year += 2000
        try:
            target_date = date(year, int(month_s), int(day_s))
            has_explicit_date_or_today = True
        except ValueError:
            pass
    elif "сьогодні" in lower_text or (created_dt.date() == datetime.now(KYIV_TZ).date() and created_dt.hour < 16):
        has_explicit_date_or_today = True
    elif "завтра" in lower_text or created_dt.hour >= 16:
        # Якщо викладач пише пост увечері (як Філімончук о 18:22) або пише слово "завтра"
        target_date = created_dt.date() + timedelta(days=1)
        has_explicit_date_or_today = True

    # 2. Визначаємо номер пари за часом (напр. "о 10:40,", "о 12-30", "о 09:03")
    lesson_number = None
    for m in TIME_RE.finditer(text):
        h, mins = int(m.group(1)), int(m.group(2))
        if 7 <= h <= 16 and 0 <= mins <= 59:
            num = _time_to_lesson_number(h, mins)
            if num is not None:
                lesson_number = num
                break

    return {
        "url": url,
        "zoom_id": zoom_id,
        "zoom_pass": zoom_pass,
        "target_date": target_date,
        "lesson_number": lesson_number,
        "has_explicit_date_or_today": has_explicit_date_or_today,
    }


def _lesson_matches_author_or_text(lesson, author_surname: str, text_lower: str) -> bool:
    """Перевіряє, чи належить пара автору поста в Classroom або згаданому в тексті предмету."""
    if author_surname and lesson.teacher_name:
        if author_surname in lesson.teacher_name.lower():
            return True

    # Перевірка назви в лапках, наприклад "Комп'ютерна електроніка", «Технології webдизайну»
    quoted_match = QUOTED_SUBJECT_RE.search(text_lower)
    if quoted_match and lesson.subject_name:
        quoted = quoted_match.group(1).strip()
        if len(quoted) >= 4 and (quoted[:8] in lesson.subject_name.lower() or lesson.subject_name.lower()[:8] in quoted):
            return True

    if lesson.subject_name:
        subj_low = lesson.subject_name.lower()
        # Перевіряємо збіг за ключовими словами предмета (напр. "комп'ютерна електроніка", "webдизайну", "української мови")
        subj_words = [w for w in re.split(r"[\s,()\-]+", subj_low) if len(w) >= 5]
        if subj_words and any(w[:6] in text_lower for w in subj_words):
            return True

    return False


@router.post("/sync")
async def sync_from_classroom(
    payload: ClassroomSyncRequest,
    db: AsyncSession = Depends(get_db),
):
    headers = {"Authorization": f"Bearer {payload.access_token}"}
    all_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1. Завантажуємо активні курси користувача в Google Classroom
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
            matched_courses = courses[:5]

        # Очищення помилково прив'язаних онлайн-посилань з уроків фізичного виховання
        pe_notes = (await db.scalars(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id == detected_group.id,
                LessonOccurrenceNote.archived.is_(False),
                LessonOccurrenceNote.subject_name.ilike("%фізичн%"),
            )
        )).all()
        for pn in pe_notes:
            cleaned = "\n".join(
                line for line in pn.note.split("\n") if not URL_RE.search(line)
            ).strip()
            if not cleaned:
                pn.archived = True
            else:
                pn.note = cleaned
            pn.revision += 1
            pn.updated_at = datetime.now(timezone.utc)

        synced_links = 0
        user_names_cache: dict[str, str] = {}

        # 2. Вичитуємо стрічку оголошень курсу групи
        for course in matched_courses:
            course_id = course["id"]
            ann_resp = await client.get(
                f"https://classroom.googleapis.com/v1/courses/{course_id}/announcements",
                params={"pageSize": 25},
                headers=headers,
            )
            if ann_resp.status_code != 200:
                continue

            announcements = ann_resp.json().get("announcements", [])
            for ann in announcements:
                text = ann.get("text", "")
                if not text:
                    continue

                created_raw = ann.get("creationTime") or ann.get("updateTime")
                created_dt = (
                    datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(KYIV_TZ)
                    if created_raw
                    else datetime.now(KYIV_TZ)
                )

                # Беремо лише свіжі оголошення за останні 7 днів
                if (datetime.now(KYIV_TZ).date() - created_dt.date()).days > 7:
                    continue

                parsed = _parse_announcement(text, created_dt)
                if not parsed["url"]:
                    continue

                # Дізнаємося ПІБ викладача-автора поста через профілі курсу (кешуємо)
                creator_id = ann.get("creatorUserId")
                author_surname = ""
                author_parts: list[str] = []
                if creator_id:
                    if creator_id not in user_names_cache:
                        prof_resp = await client.get(
                            f"https://classroom.googleapis.com/v1/courses/{course_id}/teachers/{creator_id}",
                            headers=headers,
                        )
                        if prof_resp.status_code == 200:
                            full_name = prof_resp.json().get("profile", {}).get("name", {}).get("fullName", "")
                            user_names_cache[creator_id] = full_name
                        else:
                            user_names_cache[creator_id] = ""
                    author_full = user_names_cache.get(creator_id, "")
                    # Витягуємо прізвище (напр. "Галина Домніна" -> "домніна", "Андрій Філімончук" -> "філімончук")
                    author_parts = [p.lower() for p in author_full.split() if len(p) >= 3]
                    author_surname = author_parts[-1] if author_parts else ""

                target_date: date = parsed["target_date"]
                proj_res = await build_projection(db, target_date, group_id=detected_group.id)
                day_lessons = proj_res[1] if isinstance(proj_res, tuple) else proj_res
                if not day_lessons:
                    continue

                text_lower = text.lower()
                candidate_lessons = [
                    l for l in day_lessons
                    if _lesson_matches_author_or_text(l, author_surname, text_lower)
                ]

                # 3. Знаходимо відповідну пару в розкладі на цей день
                matched_lesson = None

                if parsed["lesson_number"] is not None:
                    # 1. Якщо є і номер пари за часом, і збіг за викладачем/предметом — ідеальний збіг
                    matched_lesson = next(
                        (l for l in candidate_lessons if l.lesson_number == parsed["lesson_number"]),
                        None,
                    )
                    # 2. Дозволяємо брати пару суто за часом ЛИШЕ тоді, коли автор поста невідомий і в пості явно вказана дата (як у Домніної)
                    if not matched_lesson and not candidate_lessons and parsed.get("has_explicit_date_or_today"):
                        matched_lesson = next(
                            (l for l in day_lessons if l.lesson_number == parsed["lesson_number"]),
                            None,
                        )

                # 3. Якщо час не розпізнано або викладач помилився в часі, але в цей день у нього лише одна пара (як у Філімончука в п'ятницю)
                if not matched_lesson and len(candidate_lessons) == 1:
                    matched_lesson = candidate_lessons[0]

                if not matched_lesson or not matched_lesson.subject_id:
                    continue

                if not (1 <= matched_lesson.lesson_number <= 4):
                    continue

                # 4. Формуємо компактний запис у нотатці до пари (доступний усій групі!)
                note_lines = [parsed["url"]]
                if parsed["zoom_id"]:
                    note_lines.append(f"ID: {parsed['zoom_id']}")
                if parsed["zoom_pass"]:
                    note_lines.append(f"Код: {parsed['zoom_pass']}")
                formatted_link_note = " | ".join(note_lines)

                existing_note = await db.scalar(
                    select(LessonOccurrenceNote).where(
                        LessonOccurrenceNote.note_date == target_date,
                        LessonOccurrenceNote.group_id == detected_group.id,
                        LessonOccurrenceNote.lesson_number == matched_lesson.lesson_number,
                        LessonOccurrenceNote.archived.is_(False),
                    )
                )

                if existing_note:
                    # Прибираємо старі авто-посилання, зберігаючи власні нотатки користувачів
                    user_lines = [
                        line.strip()
                        for line in existing_note.note.split("\n")
                        if not URL_RE.search(line) and line.strip()
                    ]
                    new_note_content = (
                        f"{formatted_link_note}\n{chr(10).join(user_lines)}".strip()[:500]
                        if user_lines
                        else formatted_link_note[:500]
                    )

                    if existing_note.note != new_note_content or existing_note.subject_id != matched_lesson.subject_id:
                        existing_note.note = new_note_content
                        existing_note.subject_id = matched_lesson.subject_id
                        existing_note.subject_name = matched_lesson.subject_name or existing_note.subject_name
                        existing_note.archived = False
                        existing_note.revision += 1
                        existing_note.updated_at = datetime.now(timezone.utc)
                        synced_links += 1
                else:
                    db.add(
                        LessonOccurrenceNote(
                            note_date=target_date,
                            group_id=detected_group.id,
                            lesson_number=matched_lesson.lesson_number,
                            subject_id=matched_lesson.subject_id,
                            subject_name=matched_lesson.subject_name or "",
                            note=formatted_link_note,
                            revision=1,
                            archived=False,
                            origin_kind=getattr(matched_lesson, "source_kind", "schedule") or "schedule",
                            origin_id=getattr(matched_lesson, "source_ref_id", 0) or 0,
                        )
                    )
                    synced_links += 1

        await db.commit()

    return {
        "group_id": detected_group.id,
        "group_name": detected_group.name,
        "synced_links": synced_links,
    }
