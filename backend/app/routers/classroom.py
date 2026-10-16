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
from app.models import Group, Schedule, Subject, Teacher, ScheduleOverride
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.projection import build_projection

router = APIRouter(prefix="/api/classroom", tags=["classroom"])
KYIV_TZ = ZoneInfo("Europe/Kyiv")

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
DATE_TEXT_RE = re.compile(r"(\d{1,2})\s+([а-яіїєґ]{3,10})", re.IGNORECASE)

UKR_MONTHS = {
    "січ": 1, "лют": 2, "бер": 3, "кві": 4, "тра": 5, "чер": 6,
    "лип": 7, "сер": 8, "вер": 9, "жов": 10, "лис": 11, "гру": 12,
}


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


def _is_physical_education(subject_name: Optional[str]) -> bool:
    if not subject_name:
        return False
    sn = subject_name.lower()
    return "фізичн" in sn or "спорт" in sn


def _is_curator_hour(subject_name: Optional[str]) -> bool:
    if not subject_name:
        return False
    sn = subject_name.lower()
    return "виховн" in sn


def _parse_announcement(text: str, created_dt: datetime, materials: Optional[list] = None) -> dict:
    """Витягує з тексту оголошення дату пари, номер пари, лінк Meet/Zoom, ID та код доступу."""
    url_match = URL_RE.search(text)
    url = url_match.group(0) if url_match else None

    if not url and materials:
        for mat in materials:
            link_url = mat.get("link", {}).get("url", "")
            if URL_RE.search(link_url):
                url = URL_RE.search(link_url).group(0)
                break

    zoom_id_match = ZOOM_ID_RE.search(text)
    zoom_pass_match = ZOOM_PASS_RE.search(text)

    zoom_id = re.sub(r"[\s\-\u00a0]", "", zoom_id_match.group(1)) if zoom_id_match else None
    zoom_pass = zoom_pass_match.group(1) if zoom_pass_match else None

    # Якщо в пості немає посилання, але є Zoom ID — генеруємо пряме посилання із зашитим паролем
    if not url and zoom_id:
        url = f"https://zoom.us/j/{zoom_id}"
        if zoom_pass:
            url = f"{url}?pwd={zoom_pass}"
    elif url and "zoom.us" in url.lower() and zoom_pass and "pwd=" not in url.lower():
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}pwd={zoom_pass}"

    # Визначаємо дату пари
    target_date = created_dt.date()
    has_explicit_date = False

    date_match = DATE_RE.search(text)
    if date_match:
        day_s, month_s, year_s = date_match.groups()
        year = int(year_s) if year_s else created_dt.year
        if year < 100:
            year += 2000
        try:
            target_date = date(year, int(month_s), int(day_s))
            has_explicit_date = True
        except ValueError:
            pass
    else:
        text_date_match = DATE_TEXT_RE.search(text)
        if text_date_match:
            day_s, month_s = text_date_match.groups()
            m_prefix = month_s.lower()[:3]
            if m_prefix in UKR_MONTHS:
                try:
                    target_date = date(created_dt.year, UKR_MONTHS[m_prefix], int(day_s))
                    has_explicit_date = True
                except ValueError:
                    pass

    if not has_explicit_date:
        if "сьогодні" in text.lower() or (created_dt.date() == datetime.now(KYIV_TZ).date() and created_dt.hour < 16):
            has_explicit_date = True
        elif "завтра" in text.lower() or created_dt.hour >= 16:
            target_date = created_dt.date() + timedelta(days=1)
            has_explicit_date = True

    # Номер пари за часом
    lesson_number = None
    for m in TIME_RE.finditer(text):
        h, mins = int(m.group(1)), int(m.group(2))
        if 7 <= h <= 16 and 0 <= mins <= 59:
            num = _time_to_lesson_number(h, mins)
            if num is not None:
                lesson_number = num
                break

    has_explicit_date_or_today = has_explicit_date or ("сьогодні" in text.lower())

    return {
        "url": url,
        "zoom_id": zoom_id,
        "zoom_pass": zoom_pass,
        "target_date": target_date,
        "lesson_number": lesson_number,
        "has_explicit_date": has_explicit_date,
        "has_explicit_date_or_today": has_explicit_date_or_today,
    }


def _lesson_matches_author_or_text(lesson, author_surname: str, text_lower: str) -> bool:
    """Перевіряє, чи належить пара автору поста в Classroom або згаданому в тексті предмету."""
    if author_surname and lesson.teacher_name:
        if author_surname.lower() in lesson.teacher_name.lower():
            return True

    if lesson.subject_name:
        subj_low = lesson.subject_name.lower()
        # Перевіряємо збіг за ключовими словами предмета (напр. "комп'ютерна електроніка", "webдизайну", "української мови")
        subj_words = [w for w in re.split(r"[\s,()\-]+", subj_low) if len(w) >= 5]
        if subj_words and any(w[:6] in text_lower for w in subj_words):
            return True

    return False


def _merge_auto_link_into_note(existing_text: str, new_link: str, author_prefix: Optional[str] = None) -> str:
    """Замінює старе авто-посилання на нове, зберігаючи звичайний користувацький текст.
    Якщо вказано author_prefix (напр. 'Токарєва'), замінює тільки рядок цього викладача."""
    lines = existing_text.split("\n")
    user_lines = []
    other_auto_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        is_tech = bool(
            URL_RE.search(stripped)
            or re.match(r"^(?:id|код(?:\s+доступу)?|пароль|passcode|meeting id)\s*[:\-]", stripped, re.I)
        )
        if not is_tech:
            user_lines.append(stripped)
        else:
            if author_prefix and not stripped.lower().startswith(author_prefix.lower()):
                # Авто-посилання іншого викладача підгрупи (напр. Хочинська, коли оновлюємо Токарєву)
                other_auto_lines.append(stripped)

    all_links = other_auto_lines + [new_link]
    unique_links = []
    for lk in all_links:
        if lk not in unique_links:
            unique_links.append(lk)

    combined = unique_links + user_lines
    return "\n".join(combined).strip()



async def ensure_known_online_links(db: AsyncSession) -> None:
    """Гарантує наявність актуальних онлайн-посилань для групи 85 на активний тиждень розкладу.
    
    Фіксує перевірені постійні посилання семестру:
    - Комп'ютерна електроніка (Філімончук А.В.): https://zoom.us/j/2783533865 | Код: dfkr
    - Комп'ютерна схемотехніка (Дворніченко Н.Ф.): https://us02web.zoom.us/j/83833012124?pwd=c8TCu5Ebfxj9wBLJP9kX2f1eFkqsbP.1
    - Українська мова (Прощенко І.М.): https://meet.google.com/wis-yind-cnt
    - Іноземна мова (Токарєва О.В. / Хочинська О.С.):
        Токарєва: https://meet.google.com/vxe-jxdp-drx
        Хочинська: https://us02web.zoom.us/j/6642778085?pwd=ZzFKMHJkS0pWbjRhMEFwbHA3cXJOdz09&omn=82076789020
    - Фізичне виховання: пара є (офлайн у спортивному комплексі, без онлайн-посилань).
    """
    group = await db.scalar(
        select(Group).where(
            Group.name.in_(["85", "КІ-24-2/9-85"]),
            Group.is_active.is_(True),
        )
    )
    if not group:
        group = await db.scalar(select(Group).where(Group.id == 85))
    if not group:
        return

    # 1. Фізичне виховання:
    # Видаляємо будь-які скасування цієї пари:
    cancelled_pe_overrides = (await db.scalars(
        select(ScheduleOverride).where(
            ScheduleOverride.group_id == group.id,
            ScheduleOverride.lesson_number == 2,
            ScheduleOverride.cancelled.is_(True),
        )
    )).all()
    for pe_ov in cancelled_pe_overrides:
        await db.delete(pe_ov)

    # Фізичне виховання проводиться офлайн у спортивному комплексі (без онлайн-посилань).
    # Видаляємо або архівуємо будь-які помилкові онлайн-посилання для фізкультури на ВСІ дати:
    all_pe_notes = (await db.scalars(
        select(LessonOccurrenceNote).where(
            LessonOccurrenceNote.group_id == group.id,
            LessonOccurrenceNote.archived.is_(False),
            LessonOccurrenceNote.subject_name.ilike("%фізичн%"),
        )
    )).all()
    for pn in all_pe_notes:
        if "meet.google.com" in pn.note or "zoom.us" in pn.note:
            pn.archived = True
            pn.revision += 1
            pn.updated_at = datetime.now(timezone.utc)

    # Окремо перевіряємо 13.10.2026 на випадок помилково прив'язаного чужого лінка Грабовчак
    pe_13_note = await db.scalar(
        select(LessonOccurrenceNote).where(
            LessonOccurrenceNote.note_date == date(2026, 10, 13),
            LessonOccurrenceNote.group_id == group.id,
            LessonOccurrenceNote.lesson_number == 2,
            LessonOccurrenceNote.archived.is_(False),
        )
    )
    if pe_13_note and ("meet.google.com" in pe_13_note.note or "zoom.us" in pe_13_note.note):
        pe_13_note.archived = True
        pe_13_note.revision += 1
        pe_13_note.updated_at = datetime.now(timezone.utc)

    # Очищаємо залишкові технічні тексти | ID: ... | Код: ... коли в Zoom URL вже є повноцінний хеш pwd (>= 16 символів)
    all_notes = (await db.scalars(
        select(LessonOccurrenceNote).where(
            LessonOccurrenceNote.group_id == group.id,
            LessonOccurrenceNote.archived.is_(False),
        )
    )).all()
    for an in all_notes:
        modified = False
        new_lines = []
        for line in an.note.split("\n"):
            # Якщо в URL є повноцінний довгий Zoom-хеш pwd, тоді дубльований код прибираємо
            if "zoom.us" in line.lower() and re.search(r"[?&]pwd=[A-Za-z0-9_.\-]{16,}", line):
                cleaned_line = re.sub(
                    r"\s*\|\s*(?:ID|Код(?:\s+доступ[уа])?|Passcode|Пароль|Meeting ID).*$",
                    "",
                    line,
                    flags=re.IGNORECASE,
                ).strip()
                if cleaned_line != line:
                    modified = True
                    line = cleaned_line
            new_lines.append(line)
        if modified:
            an.note = "\n".join(new_lines).strip()
            an.revision += 1
            an.updated_at = datetime.now(timezone.utc)

    foreign_lang_note = (
        "Токарєва: https://meet.google.com/vxe-jxdp-drx\n"
        "Хочинська: https://us02web.zoom.us/j/6642778085?pwd=ZzFKMHJkS0pWbjRhMEFwbHA3cXJOdz09&omn=82076789020"
    )

    known_links = {
        "електронік": "https://zoom.us/j/2783533865 | Код: dfkr",
        "схемотехнік": "https://us02web.zoom.us/j/83833012124?pwd=c8TCu5Ebfxj9wBLJP9kX2f1eFkqsbP.1",
        "українськ": "https://meet.google.com/wis-yind-cnt",
        "іноземн": foreign_lang_note,
        "англ": foreign_lang_note,
    }

    target_mondays = [date(2026, 10, 12)]
    today_kyiv = datetime.now(KYIV_TZ).date()
    cur_mon = today_kyiv - timedelta(days=today_kyiv.weekday())
    if cur_mon not in target_mondays:
        target_mondays.append(cur_mon)

    for mon in target_mondays:
        for day_offset in range(5):
            cur_date = mon + timedelta(days=day_offset)
            proj = await build_projection(db, cur_date, group_id=group.id)
            day_lessons = proj[1] if isinstance(proj, tuple) else proj
            if not day_lessons:
                continue

            for lesson in day_lessons:
                if not lesson.subject_id or not (1 <= lesson.lesson_number <= 4):
                    continue
                if _is_physical_education(lesson.subject_name) or _is_curator_hour(lesson.subject_name):
                    continue

                subj_lower = (lesson.subject_name or "").lower()
                matched_url = None
                for keyword, url in known_links.items():
                    if keyword in subj_lower:
                        matched_url = url
                        break

                if not matched_url:
                    continue

                existing = await db.scalar(
                    select(LessonOccurrenceNote).where(
                        LessonOccurrenceNote.note_date == cur_date,
                        LessonOccurrenceNote.group_id == group.id,
                        LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                        LessonOccurrenceNote.archived.is_(False),
                    )
                )

                if existing:
                    needs_update = False
                    if "іноземн" in subj_lower or "англ" in subj_lower:
                        # Потрібно, щоб були обидва посилання — Meet для Токарєвої і Zoom для Хочинської
                        if "vxe-jxdp-drx" not in existing.note or "6642778085" not in existing.note:
                            needs_update = True
                    elif "електронік" in subj_lower:
                        if "2783533865" not in existing.note or "dfkr" not in existing.note:
                            needs_update = True
                    elif matched_url not in existing.note:
                        needs_update = True

                    if needs_update:
                        existing.note = _merge_auto_link_into_note(existing.note, matched_url)
                        existing.subject_id = lesson.subject_id
                        existing.subject_name = lesson.subject_name or existing.subject_name
                        existing.revision += 1
                        existing.updated_at = datetime.now(timezone.utc)
                else:
                    db.add(
                        LessonOccurrenceNote(
                            note_date=cur_date,
                            group_id=group.id,
                            lesson_number=lesson.lesson_number,
                            subject_id=lesson.subject_id,
                            subject_name=lesson.subject_name or "",
                            note=matched_url,
                            revision=1,
                            archived=False,
                            origin_kind=getattr(lesson, "source_kind", "schedule") or "schedule",
                            origin_id=getattr(lesson, "source_ref_id", 0) or 0,
                        )
                    )

    await db.commit()



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
            matched_courses = courses[:5]

        # Очищаємо залишкові " | ID: ... | Код: ..." з активних нотаток групи, якщо пароль вже є в URL Zoom
        all_active_notes = (await db.scalars(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id == detected_group.id,
                LessonOccurrenceNote.archived.is_(False),
            )
        )).all()
        for an in all_active_notes:
            modified = False
            new_lines = []
            for line in an.note.split("\n"):
                if "zoom.us" in line.lower() and "pwd=" in line.lower():
                    cleaned_line = re.sub(
                        r"\s*\|\s*(?:ID|Код(?:\s+доступ[уа])?|Passcode|Пароль|Meeting ID).*$",
                        "",
                        line,
                        flags=re.IGNORECASE,
                    ).strip()
                    if cleaned_line != line:
                        modified = True
                        line = cleaned_line
                new_lines.append(line)
            if modified:
                an.note = "\n".join(new_lines).strip()
                an.revision += 1
                an.updated_at = datetime.now(timezone.utc)

        synced_links = 0
        user_names_cache: dict[str, str] = {}
        parsed_announcements: list[dict] = []

        # 2. Вичитуємо оголошення з усіх курсів групи (до 50 оголошень, без жорсткого 7-денного обмеження)
        for course in matched_courses:
            course_id = course["id"]
            ann_resp = await client.get(
                f"https://classroom.googleapis.com/v1/courses/{course_id}/announcements",
                params={"pageSize": 50},
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

                parsed = _parse_announcement(text, created_dt, ann.get("materials"))
                if not parsed["url"]:
                    continue

                creator_id = ann.get("creatorUserId")
                author_surname = ""
                author_full = ""
                if creator_id:
                    if creator_id not in user_names_cache:
                        prof_resp = await client.get(
                            f"https://classroom.googleapis.com/v1/courses/{course_id}/teachers/{creator_id}",
                            headers=headers,
                        )
                        if prof_resp.status_code == 200:
                            author_full = prof_resp.json().get("profile", {}).get("name", {}).get("fullName", "")
                            user_names_cache[creator_id] = author_full
                        else:
                            user_names_cache[creator_id] = ""
                    else:
                        author_full = user_names_cache[creator_id]

                    author_parts = [p.lower() for p in author_full.split() if len(p) >= 3]
                    author_surname = author_parts[-1] if author_parts else ""

                parsed["text"] = text
                parsed["created_dt"] = created_dt
                parsed["author_surname"] = author_surname
                parsed["author_full"] = author_full
                parsed_announcements.append(parsed)

        # 3. Обробляємо розпізнані оголошення та прив'язуємо посилання до відповідних пар
        # Сортуємо за часом створення, щоб новіші пости замінювали старіші
        parsed_announcements.sort(key=lambda x: x["created_dt"])

        for pa in parsed_announcements:
            target_date = pa.get("target_date")
            if not target_date:
                continue

            proj_res = await build_projection(db, target_date, group_id=detected_group.id)
            day_lessons_raw = proj_res[1] if isinstance(proj_res, tuple) else proj_res
            if not day_lessons_raw:
                continue

            # Фізичне виховання проводиться офлайн у спортивному комплексі, без онлайн-посилань
            day_lessons = [
                l for l in day_lessons_raw
                if l.subject_id and (1 <= l.lesson_number <= 4)
                and not _is_curator_hour(l.subject_name)
                and not _is_physical_education(l.subject_name)
            ]
            if not day_lessons:
                continue

            text_lower = pa["text"].lower()
            author_surname = (pa.get("author_surname") or "").lower()

            candidate_lessons = [
                l for l in day_lessons
                if _lesson_matches_author_or_text(l, author_surname, text_lower)
            ]

            matched_lesson = None

            if pa["lesson_number"] is not None:
                # 1. Якщо є і номер пари за часом, і збіг за викладачем/предметом — ідеальний збіг
                matched_lesson = next(
                    (l for l in candidate_lessons if l.lesson_number == pa["lesson_number"]),
                    None,
                )
                # 2. Дозволяємо брати пару суто за часом ЛИШЕ тоді, коли автор поста невідомий і в пості явно вказана дата (як у Домніної)
                author_is_unknown = not author_surname or "домнін" in author_surname or "адмін" in author_surname
                if not matched_lesson and author_is_unknown and not candidate_lessons and pa.get("has_explicit_date_or_today"):
                    matched_lesson = next(
                        (l for l in day_lessons if l.lesson_number == pa["lesson_number"]),
                        None,
                    )

            # 3. Якщо час не розпізнано або викладач помилився в часі, але в цей день у нього лише одна пара (як у Філімончука в п'ятницю)
            if not matched_lesson and len(candidate_lessons) == 1:
                matched_lesson = candidate_lessons[0]

            if not matched_lesson:
                continue

            url_str = pa["url"]
            is_meet = "meet.google.com" in url_str.lower()
            has_pwd_in_url = "pwd=" in url_str.lower()
            parts_line = [url_str]
            if not is_meet and not has_pwd_in_url and pa.get("zoom_pass"):
                parts_line.append(f"Код: {pa['zoom_pass']}")
            formatted_link = " | ".join(parts_line)

            # Підтримка підгруп / кількох викладачів (наприклад "Токарєва О.В. / Хочинська О.С.")
            teacher_splits = [t.strip() for t in (matched_lesson.teacher_name or "").split("/") if t.strip()]
            author_prefix = None
            if len(teacher_splits) > 1 and author_surname:
                for ts in teacher_splits:
                    if author_surname in ts.lower():
                        author_prefix = ts.split()[0]
                        break
            if author_prefix:
                formatted_link = f"{author_prefix}: {formatted_link}"

            existing_note = await db.scalar(
                select(LessonOccurrenceNote).where(
                    LessonOccurrenceNote.note_date == target_date,
                    LessonOccurrenceNote.group_id == detected_group.id,
                    LessonOccurrenceNote.lesson_number == matched_lesson.lesson_number,
                    LessonOccurrenceNote.archived.is_(False),
                )
            )

            if existing_note:
                new_note_content = _merge_auto_link_into_note(
                    existing_note.note, formatted_link, author_prefix
                )[:500]

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
                        note=formatted_link[:500],
                        revision=1,
                        archived=False,
                        origin_kind=getattr(matched_lesson, "source_kind", "schedule") or "schedule",
                        origin_id=getattr(matched_lesson, "source_ref_id", 0) or 0,
                    )
                )
                synced_links += 1

        # Гарантуємо наявність перевірених постійних посилань та скасування фізкультури
        await ensure_known_online_links(db)
        await db.commit()

    return {
        "group_id": detected_group.id,
        "group_name": detected_group.name,
        "synced_links": synced_links,
    }
