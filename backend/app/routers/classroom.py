import logging
import re
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import require_roles
from app.database import get_db
from app.models import (
    ClassroomGroupBinding,
    Group,
    GroupStudent,
    Teacher,
    User,
)
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.projection import build_projection, build_week_projection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/classroom", tags=["classroom"])
KYIV_TZ = ZoneInfo("Europe/Kyiv")

URL_RE = re.compile(
    r"https?://(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)/[^\s<>\"')|]+",
    re.IGNORECASE,
)
ZOOM_ID_RE = re.compile(
    r"(?:[ІИіи]дент[иі]ф[иі]катор(?:\s+\S+)?|Meeting\s*ID|\bID(?:\s+\S+)?)\s*[:\-]?\s*(\d[\d\s\-\u00a0]{8,15}\d)",
    re.IGNORECASE,
)
ZOOM_PASS_RE = re.compile(
    r"(?:Код(?:\s+доступ[уае])?|Passcode|Пароль)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)",
    re.IGNORECASE,
)
DATE_RE = re.compile(r"(?<!\d)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)")
DATE_TEXT_RE = re.compile(
    r"\b(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)\b",
    re.IGNORECASE,
)
TIME_AMPM_RE = re.compile(r"(?<!\d)(\d{1,2})[:.](\d{2})\s*(AM|PM)\b", re.IGNORECASE)
TIME_PREFIX_RE = re.compile(r"(?:\bо\s+|\bоб\s+|\bв\s+|\bна\s+|\bчас\s*[:\-]?\s*)(\d{1,2})[:.\-](\d{2})(?!\d)", re.IGNORECASE)
TIME_COLON_RE = re.compile(r"(?<![.\d])(\d{1,2}):(\d{2})(?![.\d])")

UKR_MONTHS = {
    "січ": 1, "лют": 2, "бер": 3, "кві": 4, "тра": 5, "чер": 6,
    "лип": 7, "сер": 8, "вер": 9, "жов": 10, "лис": 11, "гру": 12,
}


class ClassroomSyncRequest(BaseModel):
    code: Optional[str] = None
    access_token: Optional[str] = None
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

    # 1. Пріоритет: дати з явним роком (наприклад 14.10.2026 чи 16.10.2026)
    for dm in DATE_RE.finditer(text):
        day_s, month_s, year_s = dm.groups()
        d_i, m_i = int(day_s), int(month_s)
        if 1 <= d_i <= 31 and 1 <= m_i <= 12 and year_s:
            year = int(year_s)
            if year < 100:
                year += 2000
            try:
                target_date = date(year, m_i, d_i)
                break
            except ValueError:
                continue

    # 2. Текстові дати (наприклад "16 жовтня")
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

    # 3. Числові дати без року (наприклад 12.10 або 16.10)
    if target_date is None:
        for dm in DATE_RE.finditer(text):
            day_s, month_s, year_s = dm.groups()
            d_i, m_i = int(day_s), int(month_s)
            if 1 <= d_i <= 31 and 1 <= m_i <= 12 and abs(m_i - created_dt.month) <= 1:
                try:
                    target_date = date(created_dt.year, m_i, d_i)
                    break
                except ValueError:
                    continue

    # 4. Відносні дати ("завтра", "сьогодні", або час створення)
    if target_date is None:
        if "завтра" in text_norm:
            target_date = created_dt.date() + timedelta(days=1)
        elif "сьогодні" in text_norm:
            target_date = created_dt.date()
        elif created_dt.hour >= 16:
            target_date = created_dt.date() + timedelta(days=1)
        else:
            target_date = created_dt.date()

    lesson_number: Optional[int] = None

    # Час формату 09.00 AM / 10:40 AM
    for tm in TIME_AMPM_RE.finditer(text):
        h, mins, ampm = int(tm.group(1)), int(tm.group(2)), tm.group(3).upper()
        if ampm == "PM" and h < 12:
            h += 12
        elif ampm == "AM" and h == 12:
            h = 0
        if 7 <= h <= 18 and 0 <= mins <= 59:
            lesson_number = _time_to_lesson_number(h, mins)
            if lesson_number is not None:
                break

    # Час з прийменником (о 10:40, на 09:00, о 12-30, час: 09:00)
    if lesson_number is None:
        for tm in TIME_PREFIX_RE.finditer(text_norm):
            h, mins = int(tm.group(1)), int(tm.group(2))
            if 7 <= h <= 18 and 0 <= mins <= 59:
                lesson_number = _time_to_lesson_number(h, mins)
                if lesson_number is not None:
                    break

    # Будь-який інший час через двокрапку (10:40)
    if lesson_number is None:
        for tm in TIME_COLON_RE.finditer(text_norm):
            h, mins = int(tm.group(1)), int(tm.group(2))
            if 7 <= h <= 18 and 0 <= mins <= 59:
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
    course_title_norm = ann.get("course_title_norm", "")
    author_tokens: list[str] = ann.get("author_tokens", [])

    if "виховн" in subj_norm:
        return False

    combined_text = f"{course_title_norm} {text_norm}".strip()

    lesson_surnames = [
        re.sub(r"[^а-яіїєґ']", "", part.split()[0])
        for part in teacher_norm.split("/")
        if part.strip()
    ]
    lesson_surnames = [s for s in lesson_surnames if len(s) >= 3]

    for s in lesson_surnames:
        if any(s in tok or tok in s for tok in author_tokens):
            return True
        if s in combined_text:
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
        if subj_key in subj_norm and any(tk in combined_text for tk in text_keys):
            return True

    subj_words = [w for w in re.split(r"[^а-яіїєґa-z']+", subj_norm) if len(w) >= 6]
    if subj_words and any(w[:6] in combined_text for w in subj_words):
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
    if not lesson or not getattr(lesson, "subject_id", None):
        return
    if not (1 <= getattr(lesson, "lesson_number", 0) <= 4):
        return

    active_row = (
        await db.scalars(
            select(LessonOccurrenceNote)
            .where(
                LessonOccurrenceNote.note_date == target_date,
                LessonOccurrenceNote.group_id == group_id,
                LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                LessonOccurrenceNote.archived.is_(False),
            )
            .order_by(LessonOccurrenceNote.id.desc())
            .limit(1)
        )
    ).first()

    if active_row:
        kept_lines = []
        for line in active_row.note.split("\n"):
            l_str = line.strip()
            if not l_str:
                continue
            if l_str.startswith("[TASK]"):
                kept_lines.append(l_str)
            elif URL_RE.search(l_str):
                if matched_prefix and not l_str.startswith(matched_prefix):
                    kept_lines.append(l_str)
            else:
                kept_lines.append(l_str)

        active_row.note = (
            f"{url_line}\n{chr(10).join(kept_lines)}"[:500]
            if kept_lines
            else url_line[:500]
        )
        active_row.subject_id = lesson.subject_id
        active_row.subject_name = (lesson.subject_name or active_row.subject_name)[:255]
        active_row.revision += 1
        active_row.updated_at = datetime.now(timezone.utc)
        await db.flush()
    else:
        existing_row = (
            await db.scalars(
                select(LessonOccurrenceNote)
                .where(
                    LessonOccurrenceNote.note_date == target_date,
                    LessonOccurrenceNote.group_id == group_id,
                    LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                    LessonOccurrenceNote.archived.is_(True),
                )
                .order_by(LessonOccurrenceNote.id.desc())
                .limit(1)
            )
        ).first()

        if existing_row:
            existing_row.note = url_line[:500]
            existing_row.subject_id = lesson.subject_id
            existing_row.subject_name = (lesson.subject_name or "")[:255]
            existing_row.archived = False
            existing_row.revision += 1
            existing_row.updated_at = datetime.now(timezone.utc)
            await db.flush()
        else:
            db.add(
                LessonOccurrenceNote(
                    note_date=target_date,
                    group_id=group_id,
                    lesson_number=lesson.lesson_number,
                    subject_id=lesson.subject_id,
                    subject_name=(lesson.subject_name or "")[:255],
                    note=url_line[:500],
                    revision=1,
                    archived=False,
                    origin_kind="classroom",
                    origin_id=0,
                )
            )
            await db.flush()


async def _upsert_task_line(
    db: AsyncSession,
    target_date: date,
    group_id: int,
    lesson,
    task_line: str,
    unique_link: str,
) -> bool:
    if not lesson or not getattr(lesson, "subject_id", None):
        return False
    if not (1 <= getattr(lesson, "lesson_number", 0) <= 4):
        return False

    existing = (
        await db.scalars(
            select(LessonOccurrenceNote)
            .where(
                LessonOccurrenceNote.note_date == target_date,
                LessonOccurrenceNote.group_id == group_id,
                LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                LessonOccurrenceNote.archived.is_(False),
            )
            .order_by(LessonOccurrenceNote.id.desc())
            .limit(1)
        )
    ).first()

    if existing:
        if unique_link not in existing.note:
            existing.note = f"{existing.note}\n{task_line}".strip()[:500]
            existing.subject_id = lesson.subject_id
            existing.subject_name = (lesson.subject_name or existing.subject_name)[:255]
            existing.revision += 1
            existing.updated_at = datetime.now(timezone.utc)
            await db.flush()
            return True
        return False
    else:
        archived_row = (
            await db.scalars(
                select(LessonOccurrenceNote)
                .where(
                    LessonOccurrenceNote.note_date == target_date,
                    LessonOccurrenceNote.group_id == group_id,
                    LessonOccurrenceNote.lesson_number == lesson.lesson_number,
                    LessonOccurrenceNote.archived.is_(True),
                )
                .order_by(LessonOccurrenceNote.id.desc())
                .limit(1)
            )
        ).first()

        if archived_row:
            archived_row.note = task_line[:500]
            archived_row.subject_id = lesson.subject_id
            archived_row.subject_name = (lesson.subject_name or "")[:255]
            archived_row.archived = False
            archived_row.revision += 1
            archived_row.updated_at = datetime.now(timezone.utc)
            await db.flush()
            return True
        else:
            db.add(
                LessonOccurrenceNote(
                    note_date=target_date,
                    group_id=group_id,
                    lesson_number=lesson.lesson_number,
                    subject_id=lesson.subject_id,
                    subject_name=(lesson.subject_name or "")[:255],
                    note=task_line[:500],
                    revision=1,
                    archived=False,
                    origin_kind="classroom",
                    origin_id=0,
                )
            )
            await db.flush()
            return True


async def _refresh_google_token(refresh_token: str) -> Optional[str]:
    if not settings.google_client_id or not settings.google_client_secret:
        return None
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        if resp.status_code == 200:
            return resp.json().get("access_token")
    return None


async def perform_course_sync(
    db: AsyncSession,
    group: Group,
    courses: list[dict],
    access_token: str,
    group_course_id: Optional[str] = None,
    week_start: Optional[date] = None,
) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    synced_links = 0
    synced_tasks = 0
    synced_students = 0

    today_kyiv = week_start or datetime.now(KYIV_TZ).date()
    week_monday = today_kyiv - timedelta(days=today_kyiv.weekday())
    week_friday = week_monday + timedelta(days=4)

    db_teachers = (await db.scalars(select(Teacher))).all()

    # КРОК 1: Очищаємо старі авто-посилання Meet/Zoom поточного тижня, але ЗБЕРІГАЄМО ручні нотатки та [TASK]
    all_group_notes = (
        await db.scalars(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id == group.id,
                LessonOccurrenceNote.note_date >= week_monday,
                LessonOccurrenceNote.note_date <= week_friday,
                LessonOccurrenceNote.archived.is_(False),
            )
        )
    ).all()

    for gn in all_group_notes:
        user_and_tasks = [
            line.strip()
            for line in gn.note.split("\n")
            if line.strip()
            and (
                line.strip().startswith("[TASK]")
                or (
                    not URL_RE.search(line)
                    and not re.search(r"(?:Код|ID|Passcode|Пароль)\s*:", line, re.IGNORECASE)
                )
            )
        ]
        if user_and_tasks:
            gn.note = "\n".join(user_and_tasks)
            gn.revision += 1
            gn.updated_at = datetime.now(timezone.utc)
        else:
            gn.archived = True
            gn.revision += 1
            gn.updated_at = datetime.now(timezone.utc)

    await db.flush()

    # Завантажуємо розклад поточного тижня
    _, lessons_by_day = await build_week_projection(
        db, week_monday, group_id=group.id
    )
    week_days_lessons: dict[date, list] = {}
    for weekday in range(1, 6):
        d = week_monday + timedelta(days=weekday - 1)
        week_days_lessons[d] = [
            l for l in lessons_by_day.get(weekday, [])
            if getattr(l, "subject_id", None) and (1 <= getattr(l, "lesson_number", 0) <= 4)
        ]

    parsed_announcements: list[dict] = []
    teacher_tokens_by_uid: dict[str, list[str]] = {}

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Визначаємо курси, які належать цій групі для отримання повного списку студентів
        all_active_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()
        target_group_courses = []
        for c in courses:
            full_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
            matched_other = _extract_group_from_course_name(full_title, all_active_groups)
            if matched_other:
                if matched_other.id == group.id:
                    target_group_courses.append(c)
            elif group_course_id and c.get("id") == group_course_id:
                target_group_courses.append(c)

        if not target_group_courses:
            for c in courses:
                full_title = f"{c.get('name', '')} {c.get('section', '')}".strip()
                g = _extract_group_from_course_name(full_title, [group])
                if g and g.id == group.id:
                    target_group_courses.append(c)
                    break
        if not target_group_courses and courses:
            target_group_courses = [courses[0]]

        # 1. Синхронізація списку студентів з усіх курсів групи (підгрупи, дисципліни)
        students_by_user_id: dict[str, dict] = {}
        for gc in target_group_courses:
            c_id = gc.get("id")
            if not c_id:
                continue
            try:
                page_token = None
                while True:
                    params = {"pageSize": 100}
                    if page_token:
                        params["pageToken"] = page_token
                    s_resp = await client.get(
                        f"https://classroom.googleapis.com/v1/courses/{c_id}/students",
                        params=params,
                        headers=headers,
                    )
                    if s_resp.status_code != 200:
                        break
                    s_data = s_resp.json()
                    for s_item in s_data.get("students", []):
                        uid = (s_item.get("userId") or "").strip()
                        prof = s_item.get("profile", {})
                        s_name = prof.get("name", {}).get("fullName", "").strip()
                        if not s_name:
                            continue
                        photo = prof.get("photoUrl")
                        if photo and photo.startswith("//"):
                            photo = f"https:{photo}"
                        email = (prof.get("emailAddress") or "").strip()

                        if uid not in students_by_user_id:
                            students_by_user_id[uid] = {
                                "classroom_user_id": uid[:64],
                                "full_name": s_name[:150],
                                "email": email[:150] or None,
                                "photo_url": photo[:500] if photo else None,
                            }
                        else:
                            if not students_by_user_id[uid]["email"] and email:
                                students_by_user_id[uid]["email"] = email[:150]
                            if not students_by_user_id[uid]["photo_url"] and photo:
                                students_by_user_id[uid]["photo_url"] = photo[:500]

                    page_token = s_data.get("nextPageToken")
                    if not page_token:
                        break
            except Exception as e:
                logger.warning(f"Could not sync students for course {c_id}: {e}")

        if students_by_user_id:
            await db.execute(delete(GroupStudent).where(GroupStudent.group_id == group.id))
            await db.flush()
            sorted_students = sorted(students_by_user_id.values(), key=lambda s: s["full_name"])
            for s in sorted_students:
                db.add(
                    GroupStudent(
                        group_id=group.id,
                        classroom_user_id=s["classroom_user_id"],
                        full_name=s["full_name"],
                        email=s["email"],
                        photo_url=s["photo_url"],
                    )
                )
                synced_students += 1
            await db.flush()

        # 2. Скануємо всі курси викладачів
        for course in courses:
            course_id = course["id"]
            course_title = f"{course.get('name', '')} {course.get('section', '')}".strip()
            course_title_norm = _norm(course_title)

            # Оновлюємо викладачів курсу
            try:
                t_resp = await client.get(
                    f"https://classroom.googleapis.com/v1/courses/{course_id}/teachers",
                    headers=headers,
                )
                if t_resp.status_code == 200:
                    for t_item in t_resp.json().get("teachers", []):
                        uid = t_item.get("userId")
                        prof = t_item.get("profile", {})
                        fn = prof.get("name", {}).get("fullName", "").strip()
                        email = prof.get("emailAddress")
                        if uid and fn:
                            teacher_tokens_by_uid[uid] = [w for w in _norm(fn).split() if len(w) >= 3]

                        if fn:
                            parts = [p for p in fn.split() if len(p) > 2]
                            for part in parts:
                                part_low = part.lower()
                                matched_db_t = next(
                                    (dbt for dbt in db_teachers if part_low in dbt.name.lower()),
                                    None,
                                )
                                if matched_db_t:
                                    if not matched_db_t.full_name:
                                        matched_db_t.full_name = fn[:150]
                                    if email and not matched_db_t.email:
                                        matched_db_t.email = email[:255]
                                    break
            except Exception as e:
                logger.warning(f"Could not fetch teachers for course {course_id}: {e}")

            # 3. Витягуємо оголошення зі стрічки (Meet / Zoom)
            try:
                ann_resp = await client.get(
                    f"https://classroom.googleapis.com/v1/courses/{course_id}/announcements",
                    params={"pageSize": 40},
                    headers=headers,
                )
                if ann_resp.status_code == 200:
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

                        parsed["course_title_norm"] = course_title_norm
                        creator_id = ann.get("creatorUserId", "")
                        parsed["author_tokens"] = teacher_tokens_by_uid.get(creator_id, [])
                        parsed_announcements.append(parsed)
            except Exception as e:
                logger.warning(f"Could not fetch announcements for course {course_id}: {e}")

            # 4. Витягуємо завдання ЛИШЕ з встановленою датою здачі (dueDate)
            try:
                cw_resp = await client.get(
                    f"https://classroom.googleapis.com/v1/courses/{course_id}/courseWork",
                    params={"pageSize": 30},
                    headers=headers,
                )
                if cw_resp.status_code == 200:
                    for cw in cw_resp.json().get("courseWork", []):
                        due = cw.get("dueDate")
                        # ЖОРСТКА УМОВА: якщо дати здачі немає — пропускаємо!
                        if not due or not due.get("year") or not due.get("month") or not due.get("day"):
                            continue

                        try:
                            due_date = date(int(due["year"]), int(due["month"]), int(due["day"]))
                        except ValueError:
                            continue

                        # Не додаємо дедлайни, які вже минули більше ніж 3 дні тому
                        if (datetime.now(KYIV_TZ).date() - due_date).days > 3:
                            continue

                        title = (cw.get("title") or "Завдання").strip()
                        alt_link = cw.get("alternateLink", "").strip()
                        if not alt_link:
                            continue

                        _, day_lessons = await build_projection(db, due_date, group_id=group.id)
                        if not day_lessons:
                            continue

                        valid_lessons = [
                            l for l in day_lessons
                            if getattr(l, "subject_id", None) and (1 <= getattr(l, "lesson_number", 0) <= 4) and not getattr(l, "is_cancelled", False)
                        ]
                        if not valid_lessons:
                            continue

                        author_tokens = teacher_tokens_by_uid.get(cw.get("creatorUserId", ""), [])
                        target_lesson = None

                        # Шукаємо пару з цим викладачем або предметом у день здачі
                        for l in valid_lessons:
                            t_norm = _norm(l.teacher_name)
                            s_norm = _norm(l.subject_name)
                            if author_tokens and any(tok in t_norm for tok in author_tokens):
                                target_lesson = l
                                break
                            if s_norm and len(s_norm) >= 6 and s_norm[:8] in _norm(title):
                                target_lesson = l
                                break
                            if course_title_norm and len(course_title_norm) >= 6 and s_norm and (course_title_norm in s_norm or s_norm in course_title_norm):
                                target_lesson = l
                                break

                        # Якщо в день дедлайну немає пари з цього предмета — кріпимо до першої валідної пари цього дня
                        if not target_lesson:
                            target_lesson = valid_lessons[0]

                        task_line = f"[TASK] {title[:120]} | {alt_link[:250]}"
                        added = await _upsert_task_line(
                            db=db,
                            target_date=due_date,
                            group_id=group.id,
                            lesson=target_lesson,
                            task_line=task_line,
                            unique_link=alt_link,
                        )
                        if added:
                            synced_tasks += 1
            except Exception as e:
                logger.warning(f"Could not fetch courseWork for course {course_id}: {e}")

    # КРОК 5: Ставимо розпізнані посилання Meet / Zoom на відповідні пари поточного тижня
    parsed_announcements.sort(key=lambda x: x["created_dt"])
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
            db, target_date, group.id, matched_lesson, url_line, matched_prefix
        )
        synced_links += 1

    return {
        "synced_links": synced_links,
        "synced_tasks": synced_tasks,
        "synced_students": synced_students,
    }


@router.post("/sync")
async def sync_from_classroom(
    payload: ClassroomSyncRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        access_token = payload.access_token
        refresh_token = None

        # Якщо передано authorization code (для постійного фонового синку)
        if payload.code and settings.google_client_id and settings.google_client_secret:
            async with httpx.AsyncClient(timeout=10.0) as client:
                token_resp = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": payload.code,
                        "client_id": settings.google_client_id,
                        "client_secret": settings.google_client_secret,
                        "redirect_uri": "postmessage",
                        "grant_type": "authorization_code",
                    },
                )
                if token_resp.status_code == 200:
                    token_data = token_resp.json()
                    access_token = token_data.get("access_token")
                    refresh_token = token_data.get("refresh_token")

        if not access_token:
            raise HTTPException(status_code=400, detail="Не вдалося отримати токен доступу Google")

        headers = {"Authorization": f"Bearer {access_token}"}
        all_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()

        async with httpx.AsyncClient(timeout=15.0) as client:
            courses_resp = await client.get(
                "https://classroom.googleapis.com/v1/courses",
                params={"courseStates": "ACTIVE", "pageSize": 30},
                headers=headers,
            )
            if courses_resp.status_code != 200:
                raise HTTPException(status_code=401, detail="Не вдалося прочитати курси з Google Classroom")

            courses = courses_resp.json().get("courses", [])

        detected_group: Optional[Group] = None
        matched_course = None

        if payload.group_id:
            detected_group = next((g for g in all_groups if g.id == payload.group_id), None)

        for c in courses:
            full_title = f"{c.get('name', '')} {c.get('section', '')}".strip()
            g = _extract_group_from_course_name(full_title, all_groups)
            if g:
                if detected_group is None:
                    detected_group = g
                    matched_course = c
                    break
                elif g.id == detected_group.id:
                    matched_course = c
                    break

        if not detected_group:
            raise HTTPException(
                status_code=404,
                detail="Не знайдено курс вашої групи у Classroom (наприклад, КІ-24-2/9-85).",
            )

        # Зберігаємо прив'язку курсу для автоматичного фонового оновлення всієї групи
        binding = await db.scalar(
            select(ClassroomGroupBinding).where(ClassroomGroupBinding.group_id == detected_group.id)
        )
        group_course_id = matched_course["id"] if matched_course else (courses[0]["id"] if courses else "")
        group_course_name = matched_course.get("name", "") if matched_course else (courses[0].get("name", "") if courses else "")

        if binding is None:
            binding = ClassroomGroupBinding(
                group_id=detected_group.id,
                course_id=group_course_id[:64],
                course_name=group_course_name[:200],
                access_token=access_token[:512],
                refresh_token=refresh_token[:512] if refresh_token else None,
                last_synced_at=datetime.now(timezone.utc),
                is_active=True,
            )
            db.add(binding)
        else:
            if group_course_id:
                binding.course_id = group_course_id[:64]
                binding.course_name = group_course_name[:200]
            binding.access_token = access_token[:512]
            if refresh_token:
                binding.refresh_token = refresh_token[:512]
            binding.last_synced_at = datetime.now(timezone.utc)
            binding.is_active = True

        await db.flush()

        stats = await perform_course_sync(
            db,
            detected_group,
            courses,
            access_token,
            group_course_id=binding.course_id,
            week_start=payload.week_start,
        )
        await db.commit()

        return {
            "group_id": detected_group.id,
            "group_name": detected_group.name,
            "course_name": binding.course_name,
            **stats,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Classroom sync error: {traceback.format_exc()}")
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Помилка синхронізації Classroom: {str(exc)}",
        )


async def trigger_background_sync_if_needed(db: AsyncSession, group_id: Optional[int]) -> None:
    """Автоматично оновлює дані з Classroom у фоні (не частіше ніж раз на 5 хв), якщо група підключена."""
    if not group_id:
        return
    try:
        binding = await db.scalar(
            select(ClassroomGroupBinding).where(
                ClassroomGroupBinding.group_id == group_id,
                ClassroomGroupBinding.is_active.is_(True),
            )
        )
        if not binding:
            return

        now = datetime.now(timezone.utc)
        if binding.last_synced_at and (now - binding.last_synced_at).total_seconds() < 300:
            return

        token = binding.access_token
        if binding.refresh_token:
            fresh = await _refresh_google_token(binding.refresh_token)
            if fresh:
                token = fresh
                binding.access_token = fresh

        if not token:
            return

        group = await db.get(Group, group_id)
        if not group:
            return

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            courses_resp = await client.get(
                "https://classroom.googleapis.com/v1/courses",
                params={"courseStates": "ACTIVE", "pageSize": 30},
                headers=headers,
            )
            if courses_resp.status_code != 200:
                return
            courses = courses_resp.json().get("courses", [])

        binding.last_synced_at = now
        await perform_course_sync(
            db,
            group,
            courses,
            token,
            group_course_id=binding.course_id,
        )
        await db.commit()
    except Exception as e:
        logger.warning(f"Background Classroom sync failed for group {group_id}: {e}")
        await db.rollback()


@router.get("/groups/{group_id}/students")
async def get_group_students(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    students = (
        await db.scalars(
            select(GroupStudent)
            .where(GroupStudent.group_id == group_id)
            .order_by(GroupStudent.full_name.asc())
        )
    ).all()
    binding = await db.scalar(
        select(ClassroomGroupBinding).where(ClassroomGroupBinding.group_id == group_id)
    )
    return {
        "course_name": binding.course_name if binding else None,
        "last_synced_at": binding.last_synced_at.isoformat() if (binding and binding.last_synced_at) else None,
        "students": [
            {
                "id": s.id,
                "full_name": s.full_name,
                "email": s.email,
                "photo_url": s.photo_url,
            }
            for s in students
        ],
    }
