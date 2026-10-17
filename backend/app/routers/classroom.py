import asyncio
import logging
import re
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import require_roles
from app.database import async_session_factory, get_db
from app.models import (
    ClassroomGroupBinding,
    Group,
    GroupStudent,
    Teacher,
    User,
)
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.projection import build_week_projection

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
TIME_PREFIX_RE = re.compile(
    r"(?:\bо\s+|\bоб\s+|\bв\s+|\bна\s+|\bчас\s*[:\-]?\s*)(\d{1,2})[:.\-](\d{2})(?!\d)",
    re.IGNORECASE,
)
TIME_COLON_RE = re.compile(r"(?<![.\d])(\d{1,2}):(\d{2})(?![.\d])")
LESSON_NUM_RE = re.compile(
    r"\b([1-4])(?:\s*[-–]?\s*(?:а|ша|га|тя|та|у|шу|гу|тю|ту|ій|тій))?\s+пар[ауиіою]\b",
    re.IGNORECASE,
)

UKR_MONTHS = {
    "січ": 1, "лют": 2, "бер": 3, "кві": 4, "тра": 5, "чер": 6,
    "лип": 7, "сер": 8, "вер": 9, "жов": 10, "лис": 11, "гру": 12,
}

UKR_ALPHABET = "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя"
UKR_ORDER = {ch: i for i, ch in enumerate(UKR_ALPHABET)}

COMMON_FIRST_NAMES = {
    "олександр", "максим", "артем", "дмитро", "владислав", "андрій", "данило", "іван",
    "кирило", "микита", "богдан", "денис", "євген", "євгеній", "ілля", "роман", "володимир",
    "павло", "руслан", "віталій", "ігор", "олесь", "олег", "сергій", "юрій", "ярослав",
    "тимофій", "матвій", "назар", "захар", "глеб", "гліб", "вадим", "костянтин", "микола",
    "михайло", "антон", "арсен", "арсеній", "віктор", "василь", "георгій", "давид", "марк",
    "ростислав", "святослав", "станіслав", "степан", "тарас", "федір",
    "анна", "ганна", "софія", "марія", "вікторія", "дар'я", "дарія", "анастасія",
    "катерина", "аліна", "поліна", "юлія", "ольга", "олена", "наталія", "ірина", "тетяна",
    "ксенія", "оксана", "діана", "валерія", "вероніка", "єлизавета", "мілана", "каріна",
    "христина", "ярослава", "уляна", "соломія", "маргарита", "інна", "галина",
}

STOP_WORDS = {
    "комп'ютерна", "комп'ютерні", "комп'ютер", "комп'ютерної", "комп'ютерних", "комп",
    "технології", "технологія", "технологій",
    "основи", "основа", "основ",
    "мова", "мови", "мову",
    "професійним", "професійного", "професійної", "спрямуванням", "спрямування",
    "знань", "знання",
    "вихованя", "виховання", "година", "години",
    "робота", "лабораторна", "практична", "завдання", "тема", "курс",
    "група", "групи", "коледж", "студент", "студенти",
}

SUBJECT_RULES = [
    # (корені предмета в розкладі, синоніми в Classroom, ключові корені викладачів)
    (["електронік"], ["електронік"], ["філімончук"]),
    (["схемотехнік"], ["схемотехнік"], ["дворніченк"]),
    (["дискретн", "математик"], ["дискретн", "математик"], ["гончаров"]),
    (["українськ"], ["українськ", "укр"], ["прощенк"]),
    (["іноземн"], ["іноземн", "англ", "english", "foreign"], ["токарєв", "хочинськ"]),
    (["дизайн", "web", "веб"], ["дизайн", "web", "веб"], ["грабовчак"]),
    (["філософ", "соціолог", "релігієзнав"], ["філософ", "соціолог", "релігієзнав"], ["домнін"]),
    (["фізичн вихов", "фізкультур", "спорт"], ["фізичн вихов", "фізкультур", "спорт"], ["філіппов"]),
    (["мереж"], ["мереж", "network"], []),
    (["програмув", "алгоритм", "інформатик"], ["програмув", "алгоритм", "інформатик"], []),
    (["фізик"], ["фізик"], []),
    (["історі"], ["історі", "history"], []),
]


def _norm(s: Optional[str]) -> str:
    if not s:
        return ""
    res = s.lower()
    for ch in ("’", "ʼ", "`", "´", "‘"):
        res = res.replace(ch, "'")
    return res.strip()


def extract_surname(name: str) -> str:
    parts = [p.strip() for p in (name or "").strip().split() if p.strip()]
    if len(parts) <= 1:
        return name or ""

    last_low = _norm(parts[-1])
    if last_low.endswith(("ович", "івна", "евич", "євич", "овна", "евна", "ічна")):
        return parts[0]

    first_low = _norm(parts[0])
    if first_low in COMMON_FIRST_NAMES and last_low not in COMMON_FIRST_NAMES:
        return parts[-1]
    if last_low in COMMON_FIRST_NAMES and first_low not in COMMON_FIRST_NAMES:
        return parts[0]

    def is_surname_like(w: str) -> bool:
        lw = _norm(w)
        return lw.endswith((
            "ко", "ук", "юк", "чук", "ак", "як", "ич", "іч",
            "ський", "ська", "цький", "цька", "зький", "зька",
            "ов", "ова", "єв", "єва", "ев", "ева", "ін", "іна", "їн", "їна",
            "ець", "єць", "ий", "ій", "ник", "ша", "ча", "га",
        ))

    first_like = is_surname_like(parts[0])
    last_like = is_surname_like(parts[-1])
    if first_like and not last_like:
        return parts[0]
    if not first_like and last_like:
        return parts[-1]
    return parts[-1]


def ukr_sort_key(name: str) -> list[int]:
    surname = extract_surname(name)
    surname_key = [UKR_ORDER.get(ch, 1000 + ord(ch)) for ch in _norm(surname)]
    full_key = [UKR_ORDER.get(ch, 1000 + ord(ch)) for ch in _norm(name)]
    return surname_key + [0] + full_key


class ClassroomSyncRequest(BaseModel):
    code: Optional[str] = None
    access_token: Optional[str] = None
    group_id: Optional[int] = None
    week_start: Optional[date] = None


async def ensure_known_online_links(db: AsyncSession) -> None:
    return None


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
        if 1 <= d_i <= 31 and 1 <= m_i <= 12 and year_s:
            year = int(year_s)
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
        for dm in DATE_RE.finditer(text):
            day_s, month_s, _ = dm.groups()
            d_i, m_i = int(day_s), int(month_s)
            if 1 <= d_i <= 31 and 1 <= m_i <= 12 and abs(m_i - created_dt.month) <= 1:
                try:
                    target_date = date(created_dt.year, m_i, d_i)
                    break
                except ValueError:
                    continue

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

    if lesson_number is None:
        for tm in TIME_PREFIX_RE.finditer(text_norm):
            h, mins = int(tm.group(1)), int(tm.group(2))
            if 7 <= h <= 18 and 0 <= mins <= 59:
                lesson_number = _time_to_lesson_number(h, mins)
                if lesson_number is not None:
                    break

    if lesson_number is None:
        for tm in TIME_COLON_RE.finditer(text_norm):
            h, mins = int(tm.group(1)), int(tm.group(2))
            if 7 <= h <= 18 and 0 <= mins <= 59:
                lesson_number = _time_to_lesson_number(h, mins)
                if lesson_number is not None:
                    break

    if lesson_number is None:
        lm = LESSON_NUM_RE.search(text_norm)
        if lm:
            lesson_number = int(lm.group(1))

    return {
        "url": url,
        "target_date": target_date,
        "lesson_number": lesson_number,
        "created_dt": created_dt,
        "text_norm": text_norm,
    }


def _matches_lesson(
    lesson,
    course_title_norm: str,
    text_norm: str,
    author_tokens: list[str],
) -> bool:
    subj_norm = _norm(lesson.subject_name)
    teacher_norm = _norm(lesson.teacher_name)

    if "виховн" in subj_norm:
        return False

    combined_text = f"{course_title_norm} {text_norm}".strip()

    # 1. ПЕРЕВІРКА ПО ВИКЛАДАЧУ ПАРИ
    lesson_surnames = [
        re.sub(r"[^а-яіїєґ']", "", part.split()[0])
        for part in teacher_norm.split("/")
        if part.strip()
    ]
    lesson_surnames = [s for s in lesson_surnames if len(s) >= 3 and s not in STOP_WORDS]

    teacher_matched = False
    for s in lesson_surnames:
        if any(s in tok or tok in s for tok in author_tokens):
            teacher_matched = True
            break
        if s in combined_text:
            teacher_matched = True
            break

    # 2. ПЕРЕВІРКА ЗА ПРАВИЛАМИ ПРЕДМЕТІВ
    for subj_roots, classroom_synonyms, teacher_keys in SUBJECT_RULES:
        matches_this_rule = any(sr in subj_norm for sr in subj_roots) or any(
            any(tk in s or s in tk for tk in teacher_keys)
            for s in lesson_surnames
        )
        if not matches_this_rule:
            continue

        has_synonym = any(syn in combined_text for syn in classroom_synonyms)
        has_teacher = teacher_matched or any(
            any(tk in tok or tok in tk for tok in author_tokens)
            for tk in teacher_keys
        ) or any(tk in combined_text for tk in teacher_keys)

        if has_synonym or has_teacher:
            return True
        else:
            # Урок належить до цього конкретного правила, але завдання не містить ані його синонімів, ані викладача
            return False

    # 3. Резервне співпадіння для інших дисциплін без стоп-слів
    if teacher_matched:
        return True

    words = [w for w in re.split(r"[^а-яіїєґa-z']+", subj_norm) if len(w) >= 5 and w not in STOP_WORDS]
    for w in words:
        root = w[:5]
        if root not in STOP_WORDS and root in combined_text:
            return True

    return False


def _resolve_matched_teacher_surname(lesson, author_tokens: list[str], combined_text: str) -> Optional[str]:
    """Повертає прізвище конкретного викладача ТІЛЬКИ якщо на парі двоє викладачів (підгрупи)."""
    teacher_parts = [p.strip() for p in (lesson.teacher_name or "").split("/") if p.strip()]
    if len(teacher_parts) <= 1 and not getattr(lesson, "second_teacher_id", None):
        return None

    for tp in teacher_parts:
        surname_clean = tp.split()[0].strip()
        surname_norm = re.sub(r"[^а-яіїєґ']", "", _norm(surname_clean))
        if len(surname_norm) < 3:
            continue
        if any(surname_norm in tok or tok in surname_norm for tok in author_tokens):
            return surname_clean
        if surname_norm in combined_text:
            return surname_clean

    if "токарєв" in combined_text or any("токарєв" in tok for tok in author_tokens):
        return "Токарєва"
    if "хочинськ" in combined_text or any("хочинськ" in tok for tok in author_tokens):
        return "Хочинська"

    return None


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
                if matched_prefix and not l_str.lower().startswith(matched_prefix.lower()):
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

    # КРОК 1: Глобальне м'яке очищення старих авто-посилань та старих [TASK] на всіх тижнях групи
    all_group_notes = (
        await db.scalars(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id == group.id,
                LessonOccurrenceNote.archived.is_(False),
            )
        )
    ).all()

    for gn in all_group_notes:
        manual_lines = [
            line.strip()
            for line in gn.note.split("\n")
            if line.strip()
            and not line.strip().startswith("[TASK]")
            and not URL_RE.search(line)
            and not re.search(r"(?:Код|ID|Passcode|Пароль)\s*:", line, re.IGNORECASE)
        ]
        if manual_lines:
            new_text = "\n".join(manual_lines)
            if gn.note != new_text:
                gn.note = new_text
                gn.revision += 1
                gn.updated_at = datetime.now(timezone.utc)
        else:
            gn.archived = True
            gn.revision += 1
            gn.updated_at = datetime.now(timezone.utc)

    await db.flush()

    # КРОК 2: Завантажуємо розклад одразу на 3 тижні вперед (поточний + 2 наступні),
    # щоб без N+1 запитів до БД знаходити НАСТУПНУ НАЙБЛИЖЧУ ПАРУ для дедлайнів!
    horizon_lessons_by_date: dict[date, list] = {}
    for w_offset in (0, 1, 2):
        w_mon = week_monday + timedelta(days=w_offset * 7)
        _, w_by_day = await build_week_projection(db, w_mon, group_id=group.id)
        for weekday in range(1, 6):
            d = w_mon + timedelta(days=weekday - 1)
            horizon_lessons_by_date[d] = [
                l for l in w_by_day.get(weekday, [])
                if getattr(l, "subject_id", None)
                and (1 <= getattr(l, "lesson_number", 0) <= 4)
                and not getattr(l, "is_cancelled", False)
            ]

    week_days_lessons = {
        d: lessons
        for d, lessons in horizon_lessons_by_date.items()
        if week_monday <= d <= week_friday
    }

    parsed_announcements: list[dict] = []
    raw_coursework_items: list[dict] = []
    teacher_tokens_by_uid: dict[str, list[str]] = {}

    async with httpx.AsyncClient(timeout=15.0) as client:
        all_active_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()
        target_group_courses = []
        relevant_courses = []

        for c in courses:
            full_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
            matched_other = _extract_group_from_course_name(full_title, all_active_groups)
            if matched_other:
                if matched_other.id == group.id:
                    target_group_courses.append(c)
                    relevant_courses.append(c)
            else:
                relevant_courses.append(c)
                if group_course_id and c.get("id") == group_course_id:
                    target_group_courses.append(c)

        if not target_group_courses and courses:
            target_group_courses = [courses[0]]
        if not relevant_courses:
            relevant_courses = target_group_courses

        # 1. Синхронізація списку студентів
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
                        if not s_name or not uid:
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

        # Пошук одногрупників через Google People Directory API (@kre.dp.ua)
        try:
            search_queries = [group.name]
            for gc in target_group_courses:
                c_name = (gc.get("name") or "").strip()
                if c_name and c_name not in search_queries:
                    search_queries.append(c_name)

            for sq in search_queries[:2]:
                people_resp = await client.get(
                    "https://people.googleapis.com/v1/people:searchDirectoryPeople",
                    params={
                        "query": sq,
                        "readMask": "names,emailAddresses,photos,organizations",
                        "sources": ["DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE"],
                        "pageSize": 100,
                    },
                    headers=headers,
                )
                if people_resp.status_code == 200:
                    for person in people_resp.json().get("people", []):
                        names = person.get("names", [])
                        full_name = names[0].get("displayName", "").strip() if names else ""
                        emails = person.get("emailAddresses", [])
                        email = emails[0].get("value", "").strip() if emails else ""
                        photos = person.get("photos", [])
                        photo = photos[0].get("url") if photos else None

                        if not full_name:
                            continue

                        p_uid = f"dir_{abs(hash(email or full_name)) % (10**12)}"
                        if p_uid not in students_by_user_id:
                            students_by_user_id[p_uid] = {
                                "classroom_user_id": p_uid[:64],
                                "full_name": full_name[:150],
                                "email": email[:150] or None,
                                "photo_url": photo[:500] if photo else None,
                            }
        except Exception as e:
            logger.warning(f"People API directory search skipped: {e}")

        existing_students = (
            await db.scalars(
                select(GroupStudent).where(GroupStudent.group_id == group.id)
            )
        ).all()
        existing_by_uid = {s.classroom_user_id: s for s in existing_students if s.classroom_user_id}
        existing_by_name = {_norm(s.full_name): s for s in existing_students}

        for uid, s_info in students_by_user_id.items():
            norm_name = _norm(s_info["full_name"])
            target_row = existing_by_uid.get(uid) or existing_by_name.get(norm_name)
            if target_row:
                if uid and not target_row.classroom_user_id.startswith("manual_"):
                    target_row.classroom_user_id = uid
                target_row.full_name = s_info["full_name"]
                if s_info["email"]:
                    target_row.email = s_info["email"]
                if s_info["photo_url"]:
                    target_row.photo_url = s_info["photo_url"]
            else:
                db.add(
                    GroupStudent(
                        group_id=group.id,
                        classroom_user_id=s_info["classroom_user_id"],
                        full_name=s_info["full_name"],
                        email=s_info["email"],
                        photo_url=s_info["photo_url"],
                    )
                )
                synced_students += 1
        await db.flush()

        # 2. ПАРАЛЕЛЬНЕ сканування курсів (прискорює синхронізацію в 5-6 разів)
        sem = asyncio.Semaphore(4)

        async def fetch_course_bundle(course: dict):
            c_id = course["id"]
            async with sem:
                t_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/teachers",
                    headers=headers,
                )
                a_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/announcements",
                    params={"pageSize": 25},
                    headers=headers,
                )
                cw_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWork",
                    params={"pageSize": 25},
                    headers=headers,
                )
                return course, await asyncio.gather(t_task, a_task, cw_task, return_exceptions=True)

        bundles = await asyncio.gather(*(fetch_course_bundle(c) for c in relevant_courses[:10]))

        course_teachers_tokens: dict[str, list[str]] = {}
        for course, (t_resp, ann_resp, cw_resp) in bundles:
            course_id = course["id"]
            course_title = f"{course.get('name', '')} {course.get('section', '')}".strip()
            course_title_norm = _norm(course_title)
            course_teachers_tokens[course_id] = []

            if not isinstance(t_resp, Exception) and t_resp.status_code == 200:
                for t_item in t_resp.json().get("teachers", []):
                    uid = t_item.get("userId")
                    prof = t_item.get("profile", {})
                    fn = prof.get("name", {}).get("fullName", "").strip()
                    email = prof.get("emailAddress")
                    if fn:
                        t_toks = [w for w in _norm(fn).split() if len(w) >= 3]
                        if uid:
                            teacher_tokens_by_uid[uid] = t_toks
                        course_teachers_tokens[course_id].extend(t_toks)

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

            if not isinstance(ann_resp, Exception) and ann_resp.status_code == 200:
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
                    if creator_id and creator_id not in teacher_tokens_by_uid:
                        try:
                            prof_resp = await client.get(
                                f"https://classroom.googleapis.com/v1/courses/{course_id}/teachers/{creator_id}",
                                headers=headers,
                            )
                            if prof_resp.status_code == 200:
                                fn = _norm(prof_resp.json().get("profile", {}).get("name", {}).get("fullName", ""))
                                teacher_tokens_by_uid[creator_id] = [w for w in fn.split() if len(w) >= 3]
                            else:
                                teacher_tokens_by_uid[creator_id] = []
                        except Exception:
                            teacher_tokens_by_uid[creator_id] = []

                    course_toks = course_teachers_tokens.get(course_id, [])
                    creator_toks = teacher_tokens_by_uid.get(creator_id, [])
                    parsed["course_title_norm"] = course_title_norm
                    parsed["author_tokens"] = list(set(creator_toks + course_toks))
                    parsed_announcements.append(parsed)

            if not isinstance(cw_resp, Exception) and cw_resp.status_code == 200:
                for cw in cw_resp.json().get("courseWork", []):
                    due = cw.get("dueDate")
                    if not due or not due.get("year") or not due.get("month") or not due.get("day"):
                        continue
                    try:
                        due_date = date(int(due["year"]), int(due["month"]), int(due["day"]))
                    except ValueError:
                        continue

                    if (today_kyiv - due_date).days > 3:
                        continue

                    alt_link = (cw.get("alternateLink") or "").strip()
                    if not alt_link:
                        continue

                    creator_id = cw.get("creatorUserId", "")
                    if creator_id and creator_id not in teacher_tokens_by_uid:
                        try:
                            prof_resp = await client.get(
                                f"https://classroom.googleapis.com/v1/courses/{course_id}/teachers/{creator_id}",
                                headers=headers,
                            )
                            if prof_resp.status_code == 200:
                                fn = _norm(prof_resp.json().get("profile", {}).get("name", {}).get("fullName", ""))
                                teacher_tokens_by_uid[creator_id] = [w for w in fn.split() if len(w) >= 3]
                            else:
                                teacher_tokens_by_uid[creator_id] = []
                        except Exception:
                            teacher_tokens_by_uid[creator_id] = []

                    course_toks = course_teachers_tokens.get(course_id, [])
                    creator_toks = teacher_tokens_by_uid.get(creator_id, [])
                    all_author_tokens = list(set(creator_toks + course_toks))

                    raw_coursework_items.append({
                        "due_date": due_date,
                        "alt_link": alt_link,
                        "title_norm": _norm(cw.get("title") or ""),
                        "course_title_norm": course_title_norm,
                        "author_tokens": all_author_tokens,
                    })

    # КРОК 4: Прикріплюємо домашні завдання (точна дата дедлайну -> або наступна найближча пара)
    sorted_horizon_dates = sorted(horizon_lessons_by_date.keys())

    for cw_item in raw_coursework_items:
        due_date: date = cw_item["due_date"]
        alt_link: str = cw_item["alt_link"]
        course_title_norm: str = cw_item["course_title_norm"]
        title_norm: str = cw_item["title_norm"]
        author_tokens: list[str] = cw_item["author_tokens"]
        combined_cw_text = f"{course_title_norm} {title_norm}".strip()

        target_date_for_task: Optional[date] = None
        target_lesson = None

        # 1) Перевіряємо, чи є пара з цього предмета прямо у день дедлайну
        if due_date in horizon_lessons_by_date:
            exact_candidates = [
                l for l in horizon_lessons_by_date[due_date]
                if _matches_lesson(l, course_title_norm, title_norm, author_tokens)
            ]
            if exact_candidates:
                target_lesson = exact_candidates[0]
                target_date_for_task = due_date

        # 2) Якщо на дату дедлайну пари немає — шукаємо НАСТУПНУ НАЙБЛИЖЧУ таку пару
        if target_lesson is None:
            for d_candidate in sorted_horizon_dates:
                if d_candidate <= due_date:
                    continue
                next_candidates = [
                    l for l in horizon_lessons_by_date[d_candidate]
                    if _matches_lesson(l, course_title_norm, title_norm, author_tokens)
                ]
                if next_candidates:
                    target_lesson = next_candidates[0]
                    target_date_for_task = d_candidate
                    break

        if not target_lesson or not target_date_for_task:
            continue

        # Викладач вказується ТІЛЬКИ якщо на парі двоє викладачів (підгрупи)
        teacher_badge = _resolve_matched_teacher_surname(target_lesson, author_tokens, combined_cw_text)

        # Дата дедлайну додається ТІЛЬКИ якщо на дату дедлайну пари не було (перенесено на наступну пару)
        is_shifted = target_date_for_task != due_date
        label_text = (
            f"ДЗ (до {due_date.strftime('%d.%m')})"
            if is_shifted
            else "ДЗ"
        )

        if teacher_badge:
            task_line = f"[TASK] [{teacher_badge}] {label_text} | {alt_link[:250]}"
        else:
            task_line = f"[TASK] {label_text} | {alt_link[:250]}"

        added = await _upsert_task_line(
            db=db,
            target_date=target_date_for_task,
            group_id=group.id,
            lesson=target_lesson,
            task_line=task_line,
            unique_link=alt_link,
        )
        if added:
            synced_tasks += 1

    # КРОК 5: Ставимо розпізнані посилання Meet / Zoom СТРОГО на відповідні пари поточного тижня
    parsed_announcements.sort(key=lambda x: x["created_dt"])
    for pa in parsed_announcements:
        target_date: date = pa["target_date"]
        if not (week_monday <= target_date <= week_friday):
            continue

        day_lessons = week_days_lessons.get(target_date, [])
        if not day_lessons:
            continue

        candidates = [
            l for l in day_lessons
            if _matches_lesson(l, pa.get("course_title_norm", ""), pa["text_norm"], pa.get("author_tokens", []))
        ]
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
        combined_ann = f"{pa.get('course_title_norm', '')} {pa['text_norm']}".strip()
        matched_prefix = _resolve_matched_teacher_surname(
            matched_lesson, pa.get("author_tokens", []), combined_ann
        )
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


async def run_background_sync_task(group_id: int) -> None:
    """Неблокуюча фонова задача синхронізації у власній сесії БД."""
    async with async_session_factory() as db:
        await trigger_background_sync_if_needed(db, group_id)


async def trigger_background_sync_if_needed(db: AsyncSession, group_id: Optional[int]) -> None:
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
        if binding.last_synced_at and (now - binding.last_synced_at).total_seconds() < 900:
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

        # Одразу оновлюємо мітку часу, щоб паралельні запити не запускали дубль синку
        binding.last_synced_at = now
        await db.commit()

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            courses_resp = await client.get(
                "https://classroom.googleapis.com/v1/courses",
                params={"courseStates": "ACTIVE", "pageSize": 25},
                headers=headers,
            )
            if courses_resp.status_code != 200:
                return
            courses = courses_resp.json().get("courses", [])

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
            select(GroupStudent).where(GroupStudent.group_id == group_id)
        )
    ).all()
    students = sorted(students, key=lambda s: ukr_sort_key(s.full_name))
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


class BulkStudentsPayload(BaseModel):
    raw_text: str
    replace_existing: bool = False


IGNORE_ROSTER_LINES = {
    "преподаватели", "викладачі", "teachers",
    "учащиеся", "студенти", "здобувачі освіти", "students", "classmates",
    "одногрупники", "однокурсники", "пользователи", "користувачі", "people",
    "додати", "добавить", "пригласить", "запросити", "дія", "действие", "actions",
}


@router.post("/groups/{group_id}/students/bulk")
async def bulk_import_group_students(
    group_id: int,
    payload: BulkStudentsPayload,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    group = await db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Групу не знайдено")

    if payload.replace_existing:
        await db.execute(delete(GroupStudent).where(GroupStudent.group_id == group_id))
        await db.flush()

    existing = (
        await db.scalars(select(GroupStudent).where(GroupStudent.group_id == group_id))
    ).all()
    existing_names = {_norm(s.full_name) for s in existing}

    added = 0
    for raw_line in payload.raw_text.splitlines():
        line = re.sub(r"^\s*\d+[\.\)\-]\s*", "", raw_line).strip()
        if not line or len(line) < 4:
            continue
        line_norm = _norm(line)
        if line_norm in IGNORE_ROSTER_LINES:
            continue
        if re.match(r"^\d+\s+(учащ|студент|здобувач|people|students)", line_norm):
            continue

        email_match = re.search(r"[\w.\-+]+@[\w.\-]+\.\w+", line)
        email = email_match.group(0) if email_match else None
        if email:
            line = line.replace(email, "").strip(" -|,;()\t")

        words = [w for w in line.split() if len(w) >= 2]
        if len(words) < 2 or len(words) > 4:
            continue

        clean_name = " ".join(words)[:150]
        norm_name = _norm(clean_name)
        if norm_name in existing_names:
            continue

        db.add(
            GroupStudent(
                group_id=group_id,
                classroom_user_id=f"manual_{group_id}_{abs(hash(norm_name)) % 10**8}",
                full_name=clean_name,
                email=email[:150] if email else None,
                photo_url=None,
            )
        )
        existing_names.add(norm_name)
        added += 1

    await db.commit()
    total_count = await db.scalar(
        select(func.count(GroupStudent.id)).where(GroupStudent.group_id == group_id)
    )
    return {"added": added, "total": total_count or len(existing_names)}


@router.delete("/groups/{group_id}/students/{student_id}")
async def remove_group_student(
    group_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    st = await db.scalar(
        select(GroupStudent).where(
            GroupStudent.id == student_id,
            GroupStudent.group_id == group_id,
        )
    )
    if not st:
        raise HTTPException(status_code=404, detail="Студента не знайдено")
    await db.delete(st)
    await db.commit()
    return {"status": "deleted"}
