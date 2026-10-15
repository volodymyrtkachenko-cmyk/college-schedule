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

    return {
        "url": url,
        "zoom_id": zoom_id,
        "zoom_pass": zoom_pass,
        "target_date": target_date,
        "lesson_number": lesson_number,
        "has_explicit_date": has_explicit_date,
    }


def _match_announcement_to_lesson(
    ann: dict,
    lesson,
    target_date: date,
) -> float:
    """Оцінює відповідність оголошення парі (0.0 = не підходить)."""
    if _is_curator_hour(lesson.subject_name):
        return 0.0

    # КРИТИЧНО: Якщо в пості вказано конкретну дату (наприклад 13.10),
    # посилання підтягується ВИКЛЮЧНО на цю дату, на інші тижні не поширюється!
    if ann.get("has_explicit_date") and ann.get("target_date") != target_date:
        return 0.0

    # КРИТИЧНО: Якщо в пості вказано конкретний час / номер пари (наприклад 10:40 -> 2 пара),
    # посилання підтягується ВИКЛЮЧНО на цей номер пари!
    if ann.get("lesson_number") is not None and ann.get("lesson_number") != lesson.lesson_number:
        return 0.0

    text_lower = ann["text"].lower()
    teacher_lower = (lesson.teacher_name or "").lower()
    subject_lower = (lesson.subject_name or "").lower()

    score = 0.0

    # 1. Збіг за викладачем
    author_surname = ann.get("author_surname", "")
    author_full = ann.get("author_full", "").lower()
    teacher_matched = False

    if author_surname and author_surname in teacher_lower:
        score += 25.0
        teacher_matched = True
    elif author_full and any(part in teacher_lower for part in author_full.split() if len(part) >= 4):
        score += 25.0
        teacher_matched = True
    elif author_surname and author_surname in text_lower:
        score += 15.0
        teacher_matched = True

    # 2. Збіг за предметом
    subject_matched = False

    if "електронік" in subject_lower:
        if "електронік" in text_lower:
            score += 30.0
            subject_matched = True
    elif "схемотехнік" in subject_lower:
        if "схемотехнік" in text_lower:
            score += 30.0
            subject_matched = True
    elif "українськ" in subject_lower:
        if "українськ" in text_lower or "мови за пс" in text_lower or "з української мови" in text_lower:
            score += 30.0
            subject_matched = True
    elif "дизайн" in subject_lower or "web" in subject_lower:
        if "дизайн" in text_lower or "web" in text_lower:
            score += 25.0
            subject_matched = True
    elif "математик" in subject_lower:
        if "математик" in text_lower or "дискретн" in text_lower:
            score += 25.0
            subject_matched = True
    elif "філософ" in subject_lower or "соціолог" in subject_lower:
        if "філософ" in text_lower or "соціолог" in text_lower or "релігієзнав" in text_lower:
            score += 25.0
            subject_matched = True
    elif "іноземн" in subject_lower or "англ" in subject_lower:
        if "іноземн" in text_lower or "англ" in text_lower or "токарєв" in text_lower or "хочинськ" in text_lower:
            score += 25.0
            subject_matched = True
    elif "фізичн" in subject_lower or "спорт" in subject_lower:
        if "фізичн" in text_lower or "спорт" in text_lower or teacher_matched or "філіппов" in text_lower:
            score += 30.0
            subject_matched = True
    else:
        quoted_match = QUOTED_SUBJECT_RE.search(text_lower)
        if quoted_match:
            quoted = quoted_match.group(1).strip().lower()
            if len(quoted) >= 4 and (quoted[:8] in subject_lower or subject_lower[:8] in quoted):
                score += 25.0
                subject_matched = True

    if not teacher_matched and not subject_matched:
        return 0.0

    # 3. Бонус за точний збіг дати
    if ann.get("has_explicit_date"):
        if ann.get("target_date") == target_date:
            score += 20.0
        else:
            return 0.0

    # 4. Бонус за точний збіг номера пари за часом
    if ann.get("lesson_number") is not None:
        if ann.get("lesson_number") == lesson.lesson_number:
            score += 15.0
        else:
            return 0.0

    created_ts = ann.get("created_dt", datetime.now(KYIV_TZ)).timestamp()
    score += (created_ts % 10000) / 10000.0

    return score



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

    # На конкретну дату 13.10.2026 викладач Дмитро Філіппов призначив пару онлайн:
    # "Вітаю!!! Приєднуємося 13.10 о 10:40 https://meet.google.com/ggf-ntii-kmb"
    # Додаємо це посилання виключно на цю конкретну дату (на інші тижні НЕ додаємо):
    pe_13_date = date(2026, 10, 13)
    pe_13_note = await db.scalar(
        select(LessonOccurrenceNote).where(
            LessonOccurrenceNote.note_date == pe_13_date,
            LessonOccurrenceNote.group_id == group.id,
            LessonOccurrenceNote.lesson_number == 2,
            LessonOccurrenceNote.archived.is_(False),
        )
    )
    if pe_13_note:
        if "meet.google.com/ggf-ntii-kmb" not in pe_13_note.note:
            pe_13_note.note = "https://meet.google.com/ggf-ntii-kmb"
            pe_13_note.revision += 1
            pe_13_note.updated_at = datetime.now(timezone.utc)
    else:
        proj_13 = await build_projection(db, pe_13_date, group_id=group.id)
        day_13_lessons = proj_13[1] if isinstance(proj_13, tuple) else proj_13
        pe_lesson = next((l for l in (day_13_lessons or []) if l.lesson_number == 2), None)
        db.add(
            LessonOccurrenceNote(
                note_date=pe_13_date,
                group_id=group.id,
                lesson_number=2,
                subject_id=pe_lesson.subject_id if pe_lesson else None,
                subject_name=pe_lesson.subject_name if pe_lesson else "Фізичне виховання",
                note="https://meet.google.com/ggf-ntii-kmb",
                revision=1,
                archived=False,
                origin_kind="classroom",
                origin_id=0,
            )
        )

    # На всі інші тижні фізкультура залишається без онлайн-посилань (офлайн у спортивному комплексі):
    other_pe_notes = (await db.scalars(
        select(LessonOccurrenceNote).where(
            LessonOccurrenceNote.group_id == group.id,
            LessonOccurrenceNote.note_date != pe_13_date,
            LessonOccurrenceNote.archived.is_(False),
            LessonOccurrenceNote.subject_name.ilike("%фізичн%"),
        )
    )).all()
    for opn in other_pe_notes:
        if "meet.google.com" in opn.note or "zoom.us" in opn.note:
            opn.archived = True
            opn.revision += 1
            opn.updated_at = datetime.now(timezone.utc)

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
                        user_lines = [
                            l.strip() for l in existing.note.split("\n")
                            if not URL_RE.search(l) and not re.search(r"^(?:id|код|пароль|meeting id|токарєв|хочинськ)\b", l, re.I) and l.strip()
                        ]
                        existing.note = f"{matched_url}\n{chr(10).join(user_lines)}".strip() if user_lines else matched_url
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

        # 3. Визначаємо цільові дати розкладу (активний тиждень + поточний + наступний)
        today = datetime.now(KYIV_TZ).date()
        cur_monday = today - timedelta(days=today.weekday())

        target_dates_set = set()
        target_dates_set.update(date(2026, 10, 12) + timedelta(days=i) for i in range(5))
        target_dates_set.update(cur_monday + timedelta(days=i) for i in range(5))
        target_dates_set.update(cur_monday + timedelta(days=7 + i) for i in range(5))

        for pa in parsed_announcements:
            td = pa.get("target_date")
            if td and abs((td - cur_monday).days) <= 28:
                target_dates_set.add(td)

        for target_date in sorted(target_dates_set):
            proj_res = await build_projection(db, target_date, group_id=detected_group.id)
            day_lessons = proj_res[1] if isinstance(proj_res, tuple) else proj_res
            if not day_lessons:
                continue

            for lesson in day_lessons:
                if not lesson.subject_id or not (1 <= lesson.lesson_number <= 4):
                    continue
                if _is_curator_hour(lesson.subject_name):
                    continue

                # Підтримка підгруп / кількох викладачів (наприклад "Токарєва О.В. / Хочинська О.С.")
                teacher_splits = [t.strip() for t in (lesson.teacher_name or "").split("/") if t.strip()]
                matched_links = []

                if len(teacher_splits) > 1:
                    for t_item in teacher_splits:
                        best_ann = None
                        best_score = 0.0
                        for ann in parsed_announcements:
                            fake_lesson = type("FakeLesson", (), {
                                "teacher_name": t_item,
                                "subject_name": lesson.subject_name,
                                "lesson_number": lesson.lesson_number,
                            })()
                            s = _match_announcement_to_lesson(ann, fake_lesson, target_date)
                            if s > best_score:
                                best_score = s
                                best_ann = ann
                        if best_ann and best_score >= 20.0:
                            short_name = t_item.split()[0]
                            matched_links.append(f"{short_name}: {best_ann['url']}")

                if not matched_links:
                    best_ann = None
                    best_score = 0.0
                    for ann in parsed_announcements:
                        s = _match_announcement_to_lesson(ann, lesson, target_date)
                        if s > best_score:
                            best_score = s
                            best_ann = ann

                    if best_ann and best_score >= 20.0:
                        url_str = best_ann["url"]
                        is_meet = "meet.google.com" in url_str.lower()
                        has_pwd_in_url = "pwd=" in url_str.lower()
                        parts_line = [url_str]
                        if not is_meet and not has_pwd_in_url and best_ann.get("zoom_pass"):
                            parts_line.append(f"Код: {best_ann['zoom_pass']}")
                        matched_links.append(" | ".join(parts_line))

                if not matched_links:
                    continue

                formatted_link_note = "\n".join(matched_links)

                existing_note = await db.scalar(
                    select(LessonOccurrenceNote).where(
                        LessonOccurrenceNote.note_date == target_date,
                        LessonOccurrenceNote.group_id == detected_group.id,
                        LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                        LessonOccurrenceNote.archived.is_(False),
                    )
                )

                if existing_note:
                    user_lines = [
                        line.strip()
                        for line in existing_note.note.split("\n")
                        if not URL_RE.search(line) and not re.search(r"^(?:id|код|пароль|токарєв|хочинськ)\b", line, re.I) and line.strip()
                    ]
                    new_note_content = (
                        f"{formatted_link_note}\n{chr(10).join(user_lines)}".strip()[:500]
                        if user_lines
                        else formatted_link_note[:500]
                    )

                    if existing_note.note != new_note_content or existing_note.subject_id != lesson.subject_id:
                        existing_note.note = new_note_content
                        existing_note.subject_id = lesson.subject_id
                        existing_note.subject_name = lesson.subject_name or existing_note.subject_name
                        existing_note.archived = False
                        existing_note.revision += 1
                        existing_note.updated_at = datetime.now(timezone.utc)
                        synced_links += 1
                else:
                    db.add(
                        LessonOccurrenceNote(
                            note_date=target_date,
                            group_id=detected_group.id,
                            lesson_number=lesson.lesson_number,
                            subject_id=lesson.subject_id,
                            subject_name=lesson.subject_name or "",
                            note=formatted_link_note,
                            revision=1,
                            archived=False,
                            origin_kind=getattr(lesson, "source_kind", "schedule") or "schedule",
                            origin_id=getattr(lesson, "source_ref_id", 0) or 0,
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
