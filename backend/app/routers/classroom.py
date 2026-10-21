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
from app.core.crypto import decrypt_token, encrypt_token, is_fernet_ciphertext
from app.core.security import require_roles
from app.database import async_session_factory, get_db
from app.models import (
    ClassroomCredential,
    ClassroomGroupBinding,
    Group,
    GroupStudent,
    Schedule,
    Teacher,
    User,
)
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.projection import build_week_projection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/classroom", tags=["classroom"])
KYIV_TZ = ZoneInfo("Europe/Kyiv")

DEFAULT_GOOGLE_CLIENT_ID = "1079868158360-ok75uv5l93pcql2iktfcple97sdu180b.apps.googleusercontent.com"


def get_google_client_id() -> str:
    return (settings.google_client_id or "").strip() or DEFAULT_GOOGLE_CLIENT_ID


URL_RE = re.compile(
    r"https?://(?:meet\.google\.com|[a-z0-9.-]*zoom\.us)/[^\s<>\"')|]+",
    re.IGNORECASE,
)
BARE_MEET_RE = re.compile(
    r"(?<![/\w.-])(?:meet\.google\.com/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\b",
    re.IGNORECASE,
)
ONLINE_HINT_RE = re.compile(
    r"(?:meet|zoom|конференц|ідентифікатор|meeting|код|passcode|пароль|посилання|http|[a-z]{3}-[a-z]{4}-[a-z]{3})",
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

BELL_END_MINUTES = {
    1: 10 * 60 + 20,
    2: 12 * 60 + 0,
    3: 13 * 60 + 50,
    4: 15 * 60 + 20,
}


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
    refresh_token: Optional[str] = None
    group_id: Optional[int] = None
    week_start: Optional[date] = None


class ClassroomDisconnectRequest(BaseModel):
    group_id: Optional[int] = None
    google_user_id: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None



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
        pattern = rf"(?:^|[\s\-/—_(\[])\s*{re.escape(g.name)}\s*(?:$|[\s\-/—_.)\]])"
        if re.search(pattern, course_name, re.IGNORECASE):
            return g
    return None


def _parse_announcement(text: str, created_dt: datetime, materials: Optional[list] = None) -> Optional[dict]:
    if not materials and not ONLINE_HINT_RE.search(text):
        return None

    url_match = URL_RE.search(text)
    url = url_match.group(0).rstrip(".,;!") if url_match else None

    if not url:
        bare_m = BARE_MEET_RE.search(text)
        if bare_m:
            url = f"https://meet.google.com/{bare_m.group(1).lower()}"

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
    has_explicit_date = False

    for dm in DATE_RE.finditer(text):
        day_s, month_s, year_s = dm.groups()
        d_i, m_i = int(day_s), int(month_s)
        if 1 <= d_i <= 31 and 1 <= m_i <= 12 and year_s:
            year = int(year_s)
            if year < 100:
                year += 2000
            try:
                target_date = date(year, m_i, d_i)
                has_explicit_date = True
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
                    has_explicit_date = True
                except ValueError:
                    pass

    if target_date is None:
        for dm in DATE_RE.finditer(text):
            day_s, month_s, _ = dm.groups()
            d_i, m_i = int(day_s), int(month_s)
            if 1 <= d_i <= 31 and 1 <= m_i <= 12 and abs(m_i - created_dt.month) <= 1:
                try:
                    target_date = date(created_dt.year, m_i, d_i)
                    has_explicit_date = True
                    break
                except ValueError:
                    continue

    if target_date is None:
        if "завтра" in text_norm:
            target_date = created_dt.date() + timedelta(days=1)
            has_explicit_date = True
        elif "сьогодні" in text_norm:
            target_date = created_dt.date()
            has_explicit_date = True
        elif created_dt.weekday() in (5, 6):  # Оголошення на вихідних (субота або неділя)
            # Призначається на найближчий робочий понеділок
            days_to_monday = 7 - created_dt.weekday()
            target_date = created_dt.date() + timedelta(days=days_to_monday)
            has_explicit_date = False
        else:
            target_date = created_dt.date()
            has_explicit_date = False

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
        "has_explicit_date": has_explicit_date,
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


def _fold(x: Optional[str]) -> str:
    if not x:
        return ""
    res = _norm(x)
    # Заміна схожих українських літер
    res = res.replace("є", "е").replace("ї", "і").replace("ґ", "г").replace("'", "").replace("’", "").replace("`", "")
    # Транслітерація базових сполучень латиниці для прізвищ (Tokareva, Khochynska, etc.)
    lat_map = [
        ("kh", "х"), ("ch", "ч"), ("sh", "ш"), ("zh", "ж"), ("ya", "я"), ("yu", "ю"),
        ("th", "т"), ("ph", "ф"), ("ck", "к"), ("ts", "ц"),
        ("k", "к"), ("h", "х"), ("t", "т"), ("o", "о"),
        ("a", "а"), ("r", "р"), ("e", "е"), ("v", "в"), ("w", "в"),
        ("y", "и"), ("i", "і"), ("j", "й"), ("n", "н"), ("s", "с"),
        ("c", "к"), ("m", "м"), ("l", "л"), ("d", "д"), ("b", "б"),
        ("p", "п"), ("g", "г"), ("z", "з"), ("f", "ф"),
    ]
    for lat, cyr in lat_map:
        res = res.replace(lat, cyr)
    return re.sub(r"[^а-яіїєґa-z0-9]", "", res)


def _resolve_matched_teacher_surname(
    lesson,
    author_tokens: list[str],
    combined_text: str,
    db_teachers: Optional[list] = None,
) -> Optional[str]:
    """Повертає прізвище конкретного викладача ТІЛЬКИ якщо на парі двоє викладачів (підгрупи)."""
    teacher_parts = [p.strip() for p in (lesson.teacher_name or "").split("/") if p.strip()]
    has_second = bool(getattr(lesson, "second_teacher_id", None))
    if len(teacher_parts) <= 1 and not has_second:
        return None

    # Прізвища викладачів пари
    t1_clean = teacher_parts[0].split()[0].strip() if teacher_parts else None
    t2_clean = teacher_parts[1].split()[0].strip() if len(teacher_parts) > 1 else None

    if not t2_clean and has_second and db_teachers:
        sec_t = next((t for t in db_teachers if t.id == lesson.second_teacher_id), None)
        if sec_t and sec_t.name:
            t2_clean = sec_t.name.split()[0].strip()

    if not t1_clean and getattr(lesson, "teacher_id", None) and db_teachers:
        first_t = next((t for t in db_teachers if t.id == lesson.teacher_id), None)
        if first_t and first_t.name:
            t1_clean = first_t.name.split()[0].strip()

    comb_fold = _fold(combined_text)
    all_tokens_folded = {_fold(tok) for tok in author_tokens if tok}

    # Спеціальна обробка підгруп: «1 підгрупа» -> перший викладач, «2 підгрупа» -> другий викладач
    is_subgroup_1 = bool(
        re.search(r"(?:^|[\s\-(_])(?:1|1-?ш[аеи]|перш[аеи])\s*(?:підгр|group)", combined_text, re.IGNORECASE)
        or re.search(r"(?:підгр|group)[а-я]*\s*1", combined_text, re.IGNORECASE)
        or any(k in comb_fold for k in ("1підгр", "1group", "підгрупа1", "1підгрупа", "1шапідгр"))
    )
    is_subgroup_2 = bool(
        re.search(r"(?:^|[\s\-(_])(?:2|2-?г?[аеи]|друг[аеи])\s*(?:підгр|group)", combined_text, re.IGNORECASE)
        or re.search(r"(?:підгр|group)[а-я]*\s*2", combined_text, re.IGNORECASE)
        or any(k in comb_fold for k in ("2підгр", "2group", "підгрупа2", "2підгрупа", "2гапідгр"))
    )
    if is_subgroup_1 and not is_subgroup_2:
        return t1_clean or "Токарєва"
    if is_subgroup_2 and not is_subgroup_1:
        return t2_clean or "Хочинська"

    # Порівнюємо прізвища викладачів через _fold
    candidates = [c for c in (t1_clean, t2_clean) if c]
    for cand in candidates:
        cand_fold = _fold(cand)
        if len(cand_fold) < 3:
            continue
        if any(cand_fold in tok or (len(tok) >= 4 and tok in cand_fold) for tok in all_tokens_folded):
            return cand
        if cand_fold in comb_fold:
            return cand

    # Специфічні корені для англійської (Токарєва / Хочинська)
    if any("токар" in tok for tok in all_tokens_folded) or "токар" in comb_fold:
        return t1_clean or "Токарєва"
    if any("хочин" in tok for tok in all_tokens_folded) or "хочин" in comb_fold:
        return t2_clean or "Хочинська"

    # Якщо визначити конкретного не вдалося, але це пара з двома викладачами —
    # повертаємо першого викладача, щоб посилання мало префікс і не затерло інші посилання
    return t1_clean or (teacher_parts[0].split()[0] if teacher_parts else None)


_LINK_PREFIX_RE = re.compile(
    r"^\s*(?:\[([^\]]+)\]|([А-Яа-яІіЇїЄєҐґa-zA-Z0-9'’ʼ\s.\-]{2,30}))\s*[:\-–]?\s*https?://",
    re.IGNORECASE,
)


def _link_line_prefix(line: str) -> Optional[str]:
    """Прізвище-префікс рядка з посиланням на пару з двома викладачами («Токарєва: https://...»)."""
    m = _LINK_PREFIX_RE.match(line or "")
    if not m:
        return None
    raw = (m.group(1) or m.group(2) or "").strip()
    return raw if raw else None


def _link_line_belongs_to_sync(line: str, sync_teacher_tokens: set[str]) -> bool:
    """Чи належить рядок з посиланням викладачу з курсів ПОТОЧНОГО синку.

    Рядок без прізвища (пара з одним викладачем) вважаємо належним, як і раніше.
    Рядок із прізвищем належить синку лише якщо такий викладач є у курсах цього користувача.
    Інакше це посилання іншої підгрупи, і його потрібно зберегти (Smart Merge).
    """
    prefix = _link_line_prefix(line)
    if not prefix:
        return True

    p = _fold(prefix)
    if len(p) < 3:
        return True

    folded_sync = {_fold(tok) for tok in sync_teacher_tokens if tok}

    # Якщо префікс явно вказує на підгрупу:
    if "1підгр" in p or "1group" in p or p.startswith("1"):
        return any("токар" in tok for tok in folded_sync)
    if "2підгр" in p or "2group" in p or p.startswith("2"):
        return any("хочин" in tok for tok in folded_sync)

    return any(p in tok or (len(tok) >= 4 and tok in p) for tok in folded_sync)


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
        raw_lines = [l.strip() for l in active_row.note.split("\n") if l.strip()]
        if url_line.strip() in raw_lines:
            return

        kept_lines = []
        for line in active_row.note.split("\n"):
            l_str = line.strip()
            if not l_str:
                continue
            if l_str.startswith("[TASK"):
                kept_lines.append(l_str)
            elif URL_RE.search(l_str):
                existing_prefix = _link_line_prefix(l_str)
                if matched_prefix:
                    if not l_str.lower().startswith(matched_prefix.lower()):
                        kept_lines.append(l_str)
                else:
                    if existing_prefix:
                        kept_lines.append(l_str)
            else:
                kept_lines.append(l_str)

        active_row.note = (
            f"{url_line}\n{chr(10).join(kept_lines)}"[:9500]
            if kept_lines
            else url_line[:9500]
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
            existing_row.note = url_line[:9500]
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
                    note=url_line[:9500],
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

    task_line = re.sub(r"[\r\n]+", " ", task_line).strip()

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
        clean_note = "\n".join(
            line for line in existing.note.split("\n")
            if line.strip()
            and not line.strip().startswith("[TASKS_COMPLETED]")
            and not (not line.strip().startswith("[TASK") and "classroom.google.com/" in line.lower())
        )
        if unique_link not in clean_note:
            existing.note = f"{clean_note}\n{task_line}".strip()[:9500]
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
            archived_row.note = task_line[:9500]
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
                    note=task_line[:9500],
                    revision=1,
                    archived=False,
                    origin_kind="classroom",
                    origin_id=0,
                )
            )
            await db.flush()
            return True


def _sanitize_error_msg(msg: str) -> str:
    """Ensure no tokens or secrets leak into logs or DB error strings."""
    if not msg:
        return ""
    cleaned = re.sub(r"ya29\.[A-Za-z0-9_\-\.]+", "[REDACTED_TOKEN]", msg)
    cleaned = re.sub(r"1//[A-Za-z0-9_\-\.]+", "[REDACTED_REFRESH_TOKEN]", msg)
    cleaned = re.sub(r"gAAAAA[A-Za-z0-9_\-=]+", "[REDACTED_CIPHERTEXT]", cleaned)
    return cleaned[:400]


async def _refresh_google_token_detailed(refresh_token: str) -> tuple[Optional[str], Optional[str], Optional[int]]:
    """Returns (access_token, error_code_or_msg, status_code)."""
    plain_rt = decrypt_token(refresh_token)
    if not plain_rt:
        return None, "missing_or_corrupt_refresh_token", 400
    client_id = get_google_client_id()
    if not client_id or not settings.google_client_secret:
        return None, "missing_client_secret", 400
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": plain_rt,
                    "grant_type": "refresh_token",
                },
            )
            if resp.status_code == 200:
                return resp.json().get("access_token"), None, 200
            try:
                err_data = resp.json()
                err_code = err_data.get("error") or f"http_{resp.status_code}"
                err_desc = err_data.get("error_description") or ""
                if err_code == "invalid_grant":
                    return None, f"invalid_grant: {_sanitize_error_msg(err_desc)}".strip(": "), resp.status_code
                return None, _sanitize_error_msg(f"{err_code}: {err_desc}".strip(": ")), resp.status_code
            except Exception:
                return None, f"http_{resp.status_code}", resp.status_code
    except Exception as exc:
        return None, _sanitize_error_msg(str(exc)), 500


async def _refresh_google_token(refresh_token: str) -> Optional[str]:
    tok, _, _ = await _refresh_google_token_detailed(refresh_token)
    return tok


MAX_ACCOUNTS_PER_CYCLE = 2


async def perform_course_sync(
    db: AsyncSession,
    group: Group,
    courses: list[dict],
    access_token: str,
    group_course_id: Optional[str] = None,
    week_start: Optional[date] = None,
    skip_course_ids: Optional[set[str]] = None,
) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    synced_links = 0
    synced_tasks = 0
    synced_students = 0

    now_kyiv = datetime.now(KYIV_TZ)
    today_real = now_kyiv.date()
    current_monday = today_real - timedelta(days=today_real.weekday())

    today_kyiv = week_start or today_real
    week_monday = today_kyiv - timedelta(days=today_kyiv.weekday())
    week_friday = week_monday + timedelta(days=4)

    # Вікно збереження ДЗ: попередні 2 тижні (lookback 14 днів) + поточний + наступний тиждень,
    # щоб завдання минулих тижнів прив'язувалися до пар свого тижня, а не виштовхувалися вперед
    TASKS_LOOKBACK_DAYS = 14
    tasks_window_start = min(current_monday, week_monday)
    tasks_lookback_start = tasks_window_start - timedelta(days=TASKS_LOOKBACK_DAYS)
    tasks_window_end = max(current_monday, week_monday) + timedelta(days=11)  # п'ятниця наступного тижня
    unmapped_tasks: list[dict] = []

    db_teachers = (await db.scalars(select(Teacher))).all()

    skipped_ids = {str(cid) for cid in (skip_course_ids or set()) if cid}
    effective_courses = [c for c in courses if str(c.get("id") or "") not in skipped_ids]
    current_sync_course_ids = {str(c.get("id")) for c in effective_courses if c.get("id")}

    # КРОК 1: Розумне очищення старих авто-посилань та старих [TASK]
    # Завдання інших підгруп/курсів (наприклад, іншої підгрупи англійської мови),
    # яких немає у поточному списку курсів користувача, дбайливо ЗБЕРІГАЮТЬСЯ (Smart Merge)!
    all_group_notes = (
        await db.scalars(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id == group.id,
                LessonOccurrenceNote.archived.is_(False),
            )
        )
    ).all()

    for gn in all_group_notes:
        manual_lines = []
        for line in gn.note.split("\n"):
            l_str = line.strip()
            if not l_str:
                continue
            if l_str.startswith("[TASK"):
                # Якщо завдання з іншого курсу (іншої підгрупи або вже синхронізованого в цьому циклі),
                # якого немає в effective_courses — зберігаємо його
                c_match = re.search(r"/(?:c|w)/([A-Za-z0-9_\-]+)", l_str)
                task_c_id = c_match.group(1) if c_match else None
                if task_c_id and task_c_id in current_sync_course_ids:
                    continue
                manual_lines.append(l_str)
                continue
            if "classroom.google.com/" in l_str.lower():
                continue
            if URL_RE.search(l_str):
                # Посилання не видаляємо наосліп: після завантаження викладачів курсів (КРОК 1b)
                # прибираємо лише ті, що належать викладачам ПОТОЧНОГО синку. Посилання іншої підгрупи лишаються.
                manual_lines.append(l_str)
                continue
            if re.search(r"(?:Код|ID|Passcode|Пароль)\s*:", l_str, re.IGNORECASE):
                continue
            manual_lines.append(l_str)

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

    # Додатковий захист: очищаємо залишкові авто-нотатки з інших груп,
    # які не мають власних активних прив'язок до Classroom
    active_binding_group_ids = set(
        (await db.scalars(select(ClassroomGroupBinding.group_id).where(ClassroomGroupBinding.is_active.is_(True)))).all()
    ) | set(
        (await db.scalars(select(ClassroomCredential.group_id).where(ClassroomCredential.is_active.is_(True)))).all()
    ) | {group.id}
    orphan_notes = (
        await db.scalars(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id.not_in(active_binding_group_ids),
                LessonOccurrenceNote.archived.is_(False),
                (LessonOccurrenceNote.note.like("%[TASK%") | LessonOccurrenceNote.note.like("%meet.google.com%") | LessonOccurrenceNote.note.like("%zoom.us%"))
            )
        )
    ).all()
    for on in orphan_notes:
        clean_lines = [
            l.strip()
            for l in on.note.split("\n")
            if l.strip()
            and not l.strip().startswith("[TASK")
            and not URL_RE.search(l)
            and not re.search(r"(?:Код|ID|Passcode|Пароль)\s*:", l, re.IGNORECASE)
        ]
        if clean_lines:
            on.note = "\n".join(clean_lines)
        else:
            on.archived = True
        on.revision += 1
        on.updated_at = datetime.now(timezone.utc)

    await db.flush()

    # КРОК 2: Завантажуємо розклад на розширений горизонт (2 тижні назад + поточний + наступний тиждень)
    horizon_lessons_by_date: dict[date, list] = {}
    for w_offset in (-2, -1, 0, 1):
        w_mon = tasks_window_start + timedelta(days=w_offset * 7)
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
    all_classroom_tasks: list[dict] = []
    course_cw_total: dict[str, int] = {}
    course_cw_active: dict[str, int] = {}
    teacher_tokens_by_uid: dict[str, list[str]] = {}

    async with httpx.AsyncClient(timeout=15.0) as client:
        user_email: Optional[str] = None
        google_user_id: Optional[str] = None
        try:
            me_resp = await client.get(
                "https://classroom.googleapis.com/v1/userProfiles/me",
                headers=headers,
            )
            if me_resp.status_code == 200:
                me_data = me_resp.json()
                user_email = me_data.get("emailAddress")
                google_user_id = (me_data.get("id") or "").strip() or None
        except Exception as e:
            logger.warning(f"Could not fetch user profile: {_sanitize_error_msg(str(e))}")

        all_active_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()
        target_group_courses = []
        relevant_courses = []

        for c in effective_courses:
            full_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
            matched_g = _extract_group_from_course_name(full_title, all_active_groups)
            if matched_g:
                if matched_g.id == group.id:
                    target_group_courses.append(c)
                    relevant_courses.append(c)
                # Якщо курс містить назву іншої групи — КАТЕГОРИЧНО ігноруємо його для поточної групи!
            else:
                relevant_courses.append(c)
                if group_course_id and c.get("id") == group_course_id:
                    target_group_courses.append(c)

        if not target_group_courses and effective_courses and not skipped_ids:
            # Якщо немає курсів з назвою групи, беремо лише той курс, який безпосередньо прив'язаний
            target_group_courses = [c for c in effective_courses if group_course_id and c.get("id") == group_course_id] or [effective_courses[0]]
        if not relevant_courses and not skipped_ids:
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
                logger.warning(f"Could not sync students for course {c_id}: {_sanitize_error_msg(str(e))}")

        # Пошук одногрупників через Google People Directory API (@kre.dp.ua)
        if target_group_courses:
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
                logger.warning(f"People API directory search skipped: {_sanitize_error_msg(str(e))}")

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
                    params={"pageSize": 100},
                    headers=headers,
                )
                cw_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWork",
                    params={"pageSize": 100},
                    headers=headers,
                )
                top_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/topics",
                    params={"pageSize": 50},
                    headers=headers,
                )
                mat_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWorkMaterials",
                    params={"pageSize": 100},
                    headers=headers,
                )
                sub_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWork/-/studentSubmissions",
                    params={"userId": "me", "pageSize": 100},
                    headers=headers,
                )
                return course, await asyncio.gather(t_task, a_task, cw_task, top_task, mat_task, sub_task, return_exceptions=True)

        bundles = await asyncio.gather(*(fetch_course_bundle(c) for c in relevant_courses[:30]))

        course_teachers_tokens: dict[str, list[str]] = {}
        topics_by_course: dict[str, dict[str, str]] = {}
        missing_creators: set[tuple[str, str]] = set()
        turned_in_cw_ids: set[str] = set()
        submissions_by_cw_id: dict[str, dict] = {}
        has_submission_scope_error = False
        synced_teacher_names: set[str] = set()
        synced_teacher_tokens: set[str] = set()
        synced_subgroups: set[int] = set()

        # Прохід 1: Парсимо вже отриманих викладачів/теми та збираємо невідомі creatorUserId
        for course, bundle_items in bundles:
            c_title = f"{course.get('name', '')} {course.get('section', '')}".strip()
            c_low = c_title.lower()
            if re.search(r"\b1\s*[-–—]?\s*(?:ша\s*)?підгр", c_low):
                synced_subgroups.add(1)
            if re.search(r"\b2\s*[-–—]?\s*(?:га\s*)?підгр", c_low):
                synced_subgroups.add(2)

            if len(bundle_items) >= 6:
                t_resp, ann_resp, cw_resp, top_resp, mat_resp, sub_resp = bundle_items[:6]
            else:
                t_resp, ann_resp, cw_resp, top_resp, mat_resp = bundle_items[:5]
                sub_resp = None

            course_id = course["id"]
            course_teachers_tokens[course_id] = []
            topics_by_id: dict[str, str] = {}

            if getattr(sub_resp, "status_code", None) == 403:
                has_submission_scope_error = True
            elif sub_resp is not None and not isinstance(sub_resp, Exception) and getattr(sub_resp, "status_code", None) == 200:
                for sub in sub_resp.json().get("studentSubmissions", []):
                    cw_id = sub.get("courseWorkId")
                    if cw_id:
                        sub_st = sub.get("state") or "NEW"
                        assigned_grade = sub.get("assignedGrade")
                        draft_grade = sub.get("draftGrade")
                        grade_val = assigned_grade if assigned_grade is not None else draft_grade
                        submissions_by_cw_id[cw_id] = {
                            "state": sub_st,
                            "grade": grade_val,
                        }
                        # TURNED_IN = здано студентом, RETURNED = повернуто викладачем (оцінено)
                        if sub_st in ("TURNED_IN", "RETURNED"):
                            turned_in_cw_ids.add(cw_id)

            if not isinstance(top_resp, Exception) and top_resp.status_code == 200:
                for top in top_resp.json().get("topic", []):
                    t_id, t_name = top.get("topicId"), top.get("name")
                    if t_id and t_name:
                        topics_by_id[t_id] = t_name
            topics_by_course[course_id] = topics_by_id

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
                        synced_teacher_tokens.update(t_toks)

                        parts = [p for p in fn.split() if len(p) > 2]
                        matched_db_t = None
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
                        if matched_db_t:
                            synced_teacher_names.add(matched_db_t.name)
                            synced_teacher_tokens.add(_norm(matched_db_t.name.split()[0]))
                        elif fn:
                            synced_teacher_names.add(fn)
                            f_word = fn.split()[0]
                            if len(f_word) >= 3:
                                synced_teacher_tokens.add(_norm(f_word))

            if not isinstance(ann_resp, Exception) and ann_resp.status_code == 200:
                for ann in ann_resp.json().get("announcements", []):
                    cid = ann.get("creatorUserId", "")
                    if cid and cid not in teacher_tokens_by_uid:
                        missing_creators.add((course_id, cid))

            if not isinstance(cw_resp, Exception) and cw_resp.status_code == 200:
                for cw in cw_resp.json().get("courseWork", []):
                    cid = cw.get("creatorUserId", "")
                    if cid and cid not in teacher_tokens_by_uid:
                        missing_creators.add((course_id, cid))

            if not isinstance(mat_resp, Exception) and mat_resp.status_code == 200:
                for mat in mat_resp.json().get("courseWorkMaterial", []):
                    cid = mat.get("creatorUserId", "")
                    if cid and cid not in teacher_tokens_by_uid:
                        missing_creators.add((course_id, cid))

        # Оптимізація 1.1: Завантажуємо всі відсутні профілі викладачів ОДНИМ паралельним пакетом
        if missing_creators:
            async def _fetch_missing_creator(c_id: str, u_id: str):
                async with sem:
                    try:
                        r = await client.get(
                            f"https://classroom.googleapis.com/v1/courses/{c_id}/teachers/{u_id}",
                            headers=headers,
                        )
                        if r.status_code == 200:
                            fn = _norm(r.json().get("profile", {}).get("name", {}).get("fullName", ""))
                            return u_id, [w for w in fn.split() if len(w) >= 3]
                    except Exception:
                        pass
                    return u_id, []

            fetched_profiles = await asyncio.gather(
                *(_fetch_missing_creator(c_id, u_id) for c_id, u_id in missing_creators)
            )
            for u_id, toks in fetched_profiles:
                if toks or u_id not in teacher_tokens_by_uid:
                    teacher_tokens_by_uid[u_id] = toks

        # Прохід 2: Миттєва обробка оголошень, матеріалів та ДЗ у пам'яті без жодного HTTP-запиту
        for course, bundle_items in bundles:
            if len(bundle_items) < 5:
                continue
            ann_resp = bundle_items[1]
            cw_resp = bundle_items[2]
            mat_resp = bundle_items[4]
            course_id = course["id"]
            course_title = f"{course.get('name', '')} {course.get('section', '')}".strip()
            course_title_norm = _norm(course_title)
            topics_by_id = topics_by_course.get(course_id, {})

            # 2.0. Посилання з заголовку/опису/кімнати курсу
            course_header_text = f"{course.get('descriptionHeading', '')} {course.get('description', '')} {course.get('room', '')}".strip()
            if ONLINE_HINT_RE.search(course_header_text) or URL_RE.search(course_header_text):
                parsed = _parse_announcement(course_header_text, now_kyiv, None)
                if parsed:
                    parsed["has_explicit_date"] = False
                    parsed["is_course_level"] = True
                    parsed["course_title_norm"] = course_title_norm
                    parsed["author_tokens"] = list(set(course_teachers_tokens.get(course_id, [])))
                    parsed_announcements.append(parsed)

            if not isinstance(ann_resp, Exception) and ann_resp.status_code == 200:
                for ann in ann_resp.json().get("announcements", []):
                    text = ann.get("text", "")
                    if not text:
                        continue
                    created_raw = ann.get("creationTime") or ann.get("updateTime")
                    created_dt = (
                        datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(KYIV_TZ)
                        if created_raw
                        else now_kyiv
                    )
                    parsed = _parse_announcement(text, created_dt, ann.get("materials"))
                    if not parsed:
                        continue

                    creator_id = ann.get("creatorUserId", "")
                    ann_author_tokens = list(teacher_tokens_by_uid.get(creator_id, []))
                    if len(course_teachers_tokens.get(course_id, [])) <= 2:
                        ann_author_tokens.extend(course_teachers_tokens[course_id])

                    parsed["course_title_norm"] = course_title_norm
                    parsed["author_tokens"] = list(set(ann_author_tokens))
                    parsed_announcements.append(parsed)

            if not isinstance(mat_resp, Exception) and mat_resp.status_code == 200:
                for mat in mat_resp.json().get("courseWorkMaterial", []):
                    text = f"{mat.get('title', '')}\n{mat.get('description', '')}".strip()
                    if not text and not mat.get("materials"):
                        continue
                    created_raw = mat.get("creationTime") or mat.get("updateTime")
                    created_dt = (
                        datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(KYIV_TZ)
                        if created_raw
                        else now_kyiv
                    )
                    parsed = _parse_announcement(text, created_dt, mat.get("materials"))
                    if not parsed:
                        continue

                    creator_id = mat.get("creatorUserId", "")
                    mat_author_tokens = list(teacher_tokens_by_uid.get(creator_id, []))
                    if len(course_teachers_tokens.get(course_id, [])) <= 2:
                        mat_author_tokens.extend(course_teachers_tokens[course_id])

                    parsed["course_title_norm"] = course_title_norm
                    parsed["author_tokens"] = list(set(mat_author_tokens))
                    parsed_announcements.append(parsed)


            if not isinstance(cw_resp, Exception) and cw_resp.status_code == 200:
                for cw in cw_resp.json().get("courseWork", []):
                    cw_id = cw.get("id")
                    alt_link = (cw.get("alternateLink") or "").strip()
                    if not alt_link or not cw_id:
                        continue

                    created_raw = cw.get("creationTime") or cw.get("updateTime")
                    created_dt = (
                        datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(KYIV_TZ)
                        if created_raw
                        else now_kyiv
                    )

                    due = cw.get("dueDate")
                    due_date: Optional[date] = None
                    if due and due.get("year") and due.get("month") and due.get("day"):
                        try:
                            due_date = date(int(due["year"]), int(due["month"]), int(due["day"]))
                        except ValueError:
                            due_date = None

                    title_raw = re.sub(r"\s+", " ", (cw.get("title") or "").replace("|", "/")).strip() or "Без назви"
                    max_points = cw.get("maxPoints")

                    sub_data = submissions_by_cw_id.get(cw_id)
                    if sub_data:
                        cw_state = sub_data.get("state") or "NEW"
                        assigned_grade = sub_data.get("grade")
                    else:
                        cw_state = "UNKNOWN" if has_submission_scope_error else "NEW"
                        assigned_grade = None

                    course_cw_total[course_id] = course_cw_total.get(course_id, 0) + 1
                    is_turned_in = cw_id in turned_in_cw_ids or cw_state in ("TURNED_IN", "RETURNED")
                    if not is_turned_in:
                        course_cw_active[course_id] = course_cw_active.get(course_id, 0) + 1

                    creator_id = cw.get("creatorUserId", "")
                    topic_name = topics_by_id.get(cw.get("topicId"), "")
                    topic_norm = _norm(topic_name)

                    task_author_tokens = list(teacher_tokens_by_uid.get(creator_id, []))
                    if len(course_teachers_tokens.get(course_id, [])) <= 2:
                        task_author_tokens.extend(course_teachers_tokens[course_id])

                    matched_teacher_name = None
                    for dbt in db_teachers:
                        clean_t_surname = _norm(dbt.name.split()[0])
                        if len(clean_t_surname) >= 3 and clean_t_surname in topic_norm:
                            if clean_t_surname not in task_author_tokens:
                                task_author_tokens.append(clean_t_surname)
                            if not matched_teacher_name:
                                matched_teacher_name = dbt.name

                    title_norm = _norm(title_raw)
                    combined_cw_text = f"{topic_norm} {title_norm} {course_title_norm}".strip()

                    all_classroom_tasks.append({
                        "id": cw_id,
                        "course_id": course_id,
                        "course_name": course_title,
                        "title": title_raw,
                        "subject": course.get("name", "") or course_title,
                        "teacher": matched_teacher_name or (task_author_tokens[0] if task_author_tokens else None),
                        "due_date": due_date.isoformat() if due_date else None,
                        "created_at": created_dt.isoformat(),
                        "creation_time": created_dt.isoformat(),
                        "url": alt_link,
                        "alternate_link": alt_link,
                        "state": cw_state,
                        "grade": assigned_grade,
                        "max_points": max_points,
                    })
                    # 13.3: Усі опубліковані завдання записуються в загальну базу розкладу групи,
                    # щоб не прив'язані користувачі бачили все з наявними правилами розкладу.
                    # 25.6: Персональний стан здачі (TURNED_IN, RETURNED, оцінки) НЕ впливає на спільні нотатки групи!
                    if due_date is not None:
                        if due_date > tasks_window_end:
                            unmapped_tasks.append({
                                "title": title_raw,
                                "due_date": due_date.isoformat(),
                                "reason": f"Дедлайн за межами горизонту розкладу ({due_date.strftime('%d.%m')})",
                            })
                            continue

                    raw_coursework_items.append({
                        "due_date": due_date,
                        "created_dt": created_dt,
                        "alt_link": alt_link,
                        "title_raw": title_raw,
                        "title_norm": title_norm,
                        "topic_norm": topic_norm,
                        "course_title_norm": course_title_norm,
                        "combined_text": combined_cw_text,
                        "author_tokens": list(set(task_author_tokens)),
                    })

    # КРОК 4: Прикріплюємо ДЗ (за правилами 13.1, 13.2 та 13.3)
    sorted_horizon_dates = sorted(
        d for d in horizon_lessons_by_date.keys()
        if tasks_lookback_start <= d <= tasks_window_end
    )

    # 13.3: Сортування завдань перед прив'язкою: спочатку з датою (за зростанням дедлайну), потім без дати (за датою публікації)
    raw_coursework_items.sort(
        key=lambda x: (
            0 if x["due_date"] is not None else 1,
            x["due_date"] or date.min,
            x["created_dt"],
        )
    )

    for cw_item in raw_coursework_items:
        due_date: Optional[date] = cw_item["due_date"]
        created_dt: datetime = cw_item["created_dt"]
        alt_link: str = cw_item["alt_link"]
        combined_cw_text = cw_item["combined_text"]
        author_tokens = cw_item["author_tokens"]

        target_date_for_task: Optional[date] = None
        target_lesson = None

        if due_date is not None:
            # 13.1 Завдання з датою здачі:
            # • Завдання прив'язується до пари того самого предмета і викладача в тижні, який містить дату здачі.
            due_monday = due_date - timedelta(days=due_date.weekday())
            due_friday = due_monday + timedelta(days=4)

            week_candidates = [
                (d, l)
                for d in sorted_horizon_dates
                if due_monday <= d <= due_friday and d in horizon_lessons_by_date
                for l in horizon_lessons_by_date[d]
                if _matches_lesson(l, combined_cw_text, "", author_tokens)
            ]

            if week_candidates:
                # • Якщо в цьому тижні кілька пар предмета, береться найближча пара в день здачі або після нього;
                after_or_on_due = [c for c in week_candidates if c[0] >= due_date]
                if after_or_on_due:
                    target_date_for_task, target_lesson = after_or_on_due[0]
                else:
                    # якщо таких немає, то остання пара до дати здачі.
                    target_date_for_task, target_lesson = week_candidates[-1]
            else:
                # • Якщо в тижні дати здачі пари предмета немає, завдання прив'язується до першої наступної пари цього предмета після дати здачі.
                next_candidates = [
                    (d, l)
                    for d in sorted_horizon_dates
                    if d > due_friday and d in horizon_lessons_by_date
                    for l in horizon_lessons_by_date[d]
                    if _matches_lesson(l, combined_cw_text, "", author_tokens)
                ]
                if next_candidates:
                    target_date_for_task, target_lesson = next_candidates[0]
        else:
            # 13.2 Завдання без дати здачі:
            # • Прив'язується до першої пари предмета після дати публікації завдання (creationTime з Classroom).
            created_date = created_dt.date()
            created_mins = created_dt.hour * 60 + created_dt.minute

            for d_candidate in sorted_horizon_dates:
                if d_candidate < created_date:
                    continue
                day_matches = [
                    l for l in horizon_lessons_by_date.get(d_candidate, [])
                    if _matches_lesson(l, combined_cw_text, "", author_tokens)
                ]
                if not day_matches:
                    continue

                if d_candidate == created_date:
                    after_creation = [
                        l for l in day_matches
                        if BELL_END_MINUTES.get(l.lesson_number, 15 * 60) > created_mins
                    ]
                    if after_creation:
                        target_lesson = after_creation[0]
                        target_date_for_task = d_candidate
                        break
                else:
                    target_lesson = day_matches[0]
                    target_date_for_task = d_candidate
                    break

        if not target_lesson or not target_date_for_task:
            unmapped_tasks.append({
                "title": cw_item.get("title_raw", "Без назви"),
                "due_date": due_date.isoformat() if due_date else None,
                "reason": "Не знайдено відповідної пари в розкладі (предмет або викладач не збіглися)",
            })
            continue

        teacher_badge = _resolve_matched_teacher_surname(
            target_lesson, author_tokens, combined_cw_text, db_teachers
        )

        task_title = (cw_item.get("title_raw") or "").strip() or "Домашнє завдання"
        # 13.2: Для завдань без дати здачі не показується жодна дата. Лише назва, предмет, викладач і посилання.
        label_text = (
            f"{task_title} (до {due_date.strftime('%d.%m')})"
            if due_date is not None
            else task_title
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

    # Очищуємо застарілі примітки [TASKS_COMPLETED], оскільки стан здачі є персональним
    # лише для студента, який прив'язав свою пошту в браузері
    await db.execute(
        delete(LessonOccurrenceNote).where(
            LessonOccurrenceNote.group_id == group.id,
            LessonOccurrenceNote.note.like("%[TASKS_COMPLETED]%"),
        )
    )

    # КРОК 5: Ставимо розпізнані посилання Meet / Zoom СТРОГО на відповідні пари поточного тижня
    parsed_announcements.sort(key=lambda x: x["created_dt"])
    # КРОК 1b: Smart Merge для посилань. Тепер відомо, які викладачі є у курсах цього користувача,
    # тож видаляємо лише застарілі посилання ЇХ, а посилання викладачів іншої підгрупи зберігаємо.
    sync_teacher_tokens = {tok for toks in course_teachers_tokens.values() for tok in toks}
    synced_subject_ids: set[int] = set()
    for course, _ in bundles:
        c_id = course["id"]
        c_title_norm = _norm(f"{course.get('name', '')} {course.get('section', '')}".strip())
        c_toks = course_teachers_tokens.get(c_id, [])
        for d_lessons in week_days_lessons.values():
            for l_obj in d_lessons:
                if getattr(l_obj, "subject_id", None) and _matches_lesson(l_obj, c_title_norm, "", c_toks):
                    synced_subject_ids.add(l_obj.subject_id)

    for gn in all_group_notes:
        if gn.archived:
            continue
        kept: list[str] = []
        changed = False
        for line in gn.note.split("\n"):
            l_str = line.strip()
            if not l_str:
                continue
            if (
                not l_str.startswith("[TASK")
                and URL_RE.search(l_str)
                and _link_line_belongs_to_sync(l_str, sync_teacher_tokens)
            ):
                # Якщо це безпрефіксне посилання (спільна пара), а ми у режимі дедуплікації курсів (skip_course_ids),
                # очищуємо його лише якщо предмет пари входить до фактично оброблених курсів цього синку
                if skipped_ids and _link_line_prefix(l_str) is None:
                    if gn.subject_id not in synced_subject_ids:
                        kept.append(l_str)
                        continue
                changed = True
                continue
            kept.append(l_str)
        if changed:
            if kept:
                gn.note = "\n".join(kept)
            else:
                gn.archived = True
            gn.revision += 1
            gn.updated_at = datetime.now(timezone.utc)
    await db.flush()

    for pa in parsed_announcements:
        target_date: date = pa["target_date"]
        has_explicit_date: bool = pa.get("has_explicit_date", False)
        is_course_level: bool = pa.get("is_course_level", False)

        if has_explicit_date:
            candidate_dates = [target_date] if (week_monday <= target_date <= week_friday) else []
        elif is_course_level:
            candidate_dates = [d for d in sorted(week_days_lessons.keys()) if week_monday <= d <= week_friday]
        else:
            # Оголошення без явної дати прив'язується ВИКЛЮЧНО до своєї цільової дати
            # Публікації з інших тижнів КАТЕГОРИЧНО не прив'язуються до поточного
            candidate_dates = [target_date] if (week_monday <= target_date <= week_friday) else []

        for c_date in candidate_dates:
            day_lessons = week_days_lessons.get(c_date, [])
            if not day_lessons:
                continue

            candidates = [
                l for l in day_lessons
                if _matches_lesson(l, pa.get("course_title_norm", ""), pa["text_norm"], pa.get("author_tokens", []))
            ]
            matched_lessons = []

            if pa["lesson_number"] is not None:
                matched_lessons = [l for l in candidates if l.lesson_number == pa["lesson_number"]]
                if not matched_lessons and not candidates and has_explicit_date and c_date == target_date:
                    fallback_l = next(
                        (l for l in day_lessons if l.lesson_number == pa["lesson_number"]),
                        None,
                    )
                    if fallback_l:
                        matched_lessons = [fallback_l]
            elif candidates:
                matched_lessons = candidates

            if not matched_lessons:
                continue

            for matched_lesson in matched_lessons:
                url_line = pa["url"]
                combined_ann = f"{pa.get('course_title_norm', '')} {pa['text_norm']}".strip()
                matched_prefix = _resolve_matched_teacher_surname(
                    matched_lesson, pa.get("author_tokens", []), combined_ann, db_teachers
                )
                if matched_prefix:
                    url_line = f"{matched_prefix}: {url_line}"

                await _save_link_to_slot(
                    db, c_date, group.id, matched_lesson, url_line, matched_prefix
                )
                synced_links += 1

    _latest_unmapped_tasks[group.id] = unmapped_tasks

    # Smart Merge: зберігаємо завдання курсів інших підгруп, яких не було в цьому синку
    existing_tasks = _latest_group_tasks.get(group.id, [])
    preserved_tasks = [
        t for t in existing_tasks
        if str(t.get("course_id")) not in current_sync_course_ids
    ]
    new_group_tasks = [
        {**t, "state": "NEW", "grade": None}
        for t in all_classroom_tasks
    ]
    seen_task_keys = set()
    combined_tasks: list[dict] = []
    for t in new_group_tasks:
        k = str(t.get("url") or t.get("alternate_link") or t.get("id") or "")
        if k:
            seen_task_keys.add(k)
        combined_tasks.append(t)
    for pt in preserved_tasks:
        k = str(pt.get("url") or pt.get("alternate_link") or pt.get("id") or "")
        if k and k in seen_task_keys:
            continue
        if k:
            seen_task_keys.add(k)
        combined_tasks.append(pt)

    _latest_group_tasks[group.id] = combined_tasks
    _latest_scope_missing[group.id] = has_submission_scope_error

    for tok in synced_teacher_tokens:
        if "токар" in tok:
            synced_subgroups.add(1)
        elif "хочин" in tok:
            synced_subgroups.add(2)

    return {
        "user_email": user_email,
        "google_user_id": google_user_id,
        "synced_course_ids": list(current_sync_course_ids),
        "synced_teacher_names": sorted(list(synced_teacher_names)),
        "synced_teacher_tokens": sorted(list(synced_teacher_tokens)),
        "synced_subgroups": sorted(list(synced_subgroups)),
        "synced_links": synced_links,
        "synced_tasks": synced_tasks,
        "synced_students": synced_students,
        "unmapped_tasks": unmapped_tasks,
        "tasks": combined_tasks,
        "personal_tasks": all_classroom_tasks,
        "needs_reconnect": has_submission_scope_error,
    }


@router.post("/sync")
async def sync_from_classroom(
    payload: ClassroomSyncRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        access_token = payload.access_token
        refresh_token = payload.refresh_token

        if payload.code:
            client_id = get_google_client_id()
            if not client_id or not settings.google_client_secret:
                logger.warning("Google OAuth code exchange requested, but GOOGLE_CLIENT_SECRET is missing in backend settings.")
                raise HTTPException(
                    status_code=400,
                    detail="GOOGLE_CLIENT_SECRET не налаштовано на сервері для отримання refresh_token. Використайте пряму синхронізацію або додайте GOOGLE_CLIENT_SECRET у fly secrets.",
                )
            async with httpx.AsyncClient(timeout=10.0) as client:
                token_resp = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": payload.code,
                        "client_id": client_id,
                        "client_secret": settings.google_client_secret,
                        "redirect_uri": "postmessage",
                        "grant_type": "authorization_code",
                    },
                )
                if token_resp.status_code == 200:
                    token_data = token_resp.json()
                    access_token = token_data.get("access_token")
                    refresh_token = token_data.get("refresh_token") or refresh_token
                else:
                    logger.warning(
                        f"Failed to exchange code: {token_resp.status_code} {_sanitize_error_msg(token_resp.text)}"
                    )
                    raise HTTPException(
                        status_code=400,
                        detail=f"Не вдалося обміняти код авторизації Google: {_sanitize_error_msg(token_resp.text)[:200]}",
                    )

        if not access_token and refresh_token:
            access_token = await _refresh_google_token(refresh_token)

        if not access_token:
            raise HTTPException(status_code=400, detail="Не вдалося отримати токен доступу Google")

        headers = {"Authorization": f"Bearer {access_token}"}
        all_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()

        google_user_id: Optional[str] = None
        profile_email: Optional[str] = None

        async with httpx.AsyncClient(timeout=15.0) as client:
            courses_resp = await client.get(
                "https://classroom.googleapis.com/v1/courses",
                params={"courseStates": "ACTIVE", "pageSize": 100},
                headers=headers,
            )
            if courses_resp.status_code == 401 and refresh_token:
                fresh_token = await _refresh_google_token(refresh_token)
                if fresh_token:
                    access_token = fresh_token
                    headers = {"Authorization": f"Bearer {access_token}"}
                    courses_resp = await client.get(
                        "https://classroom.googleapis.com/v1/courses",
                        params={"courseStates": "ACTIVE", "pageSize": 100},
                        headers=headers,
                    )
            if courses_resp.status_code != 200:
                raise HTTPException(status_code=401, detail="Не вдалося прочитати курси з Google Classroom")

            courses = courses_resp.json().get("courses", [])

            # 25.4.1: Викликаємо userProfiles/me і беремо стабільний id акаунта
            try:
                me_resp = await client.get(
                    "https://classroom.googleapis.com/v1/userProfiles/me",
                    headers=headers,
                )
                if me_resp.status_code == 200:
                    me_json = me_resp.json()
                    google_user_id = str(me_json.get("id") or "").strip() or None
                    profile_email = (me_json.get("emailAddress") or "").strip() or None
            except Exception as exc:
                logger.warning(f"Failed to read userProfiles/me during sync: {_sanitize_error_msg(str(exc))}")

        courses_by_group_id: dict[int, tuple[Group, dict]] = {}
        for c in courses:
            full_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
            g = _extract_group_from_course_name(full_title, all_groups)
            if g and g.id not in courses_by_group_id:
                courses_by_group_id[g.id] = (g, c)

        detected_group: Optional[Group] = None
        matched_course = None

        if len(courses_by_group_id) == 1:
            # У студента курси лише однієї групи -> ігноруємо чужу відкриту вкладку і беремо його реальну групу!
            detected_group, matched_course = next(iter(courses_by_group_id.values()))
        elif len(courses_by_group_id) > 1:
            # У викладача курси кількох груп -> якщо відкрита вкладка є серед його курсів, синхронізуємо її
            if payload.group_id and payload.group_id in courses_by_group_id:
                detected_group, matched_course = courses_by_group_id[payload.group_id]
            else:
                detected_group, matched_course = next(iter(courses_by_group_id.values()))

        if not detected_group:
            raise HTTPException(
                status_code=404,
                detail="Не знайдено курс вашої групи у Classroom (наприклад, КІ-24-2/9-85).",
            )

        now_utc = datetime.now(timezone.utc)
        plain_refresh = decrypt_token(refresh_token) if refresh_token else ""
        encrypted_refresh = encrypt_token(plain_refresh) if plain_refresh else None

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
                access_token=encrypt_token(access_token)[:512] if access_token else None,
                refresh_token=encrypted_refresh[:512] if encrypted_refresh else None,
                last_synced_at=now_utc,
                is_active=True,
            )
            db.add(binding)
        else:
            if group_course_id:
                binding.course_id = group_course_id[:64]
                binding.course_name = group_course_name[:200]
            binding.access_token = encrypt_token(access_token)[:512] if access_token else None
            if encrypted_refresh:
                binding.refresh_token = encrypted_refresh[:512]
            binding.last_synced_at = now_utc
            binding.is_active = True

        # Видаляємо лише дублікати прив'язки цього ж курсу до чужих груп, НЕ чіпаючи інші підключені групи!
        if len(courses_by_group_id) == 1 and group_course_id:
            await db.execute(
                delete(ClassroomGroupBinding).where(
                    ClassroomGroupBinding.group_id != detected_group.id,
                    ClassroomGroupBinding.course_id == group_course_id[:64],
                )
            )

        await db.flush()

        stats = await perform_course_sync(
            db,
            detected_group,
            courses,
            access_token,
            group_course_id=binding.course_id,
            week_start=payload.week_start,
        )

        effective_user_id = (
            google_user_id
            or stats.get("google_user_id")
            or profile_email
            or stats.get("user_email")
        )
        if not effective_user_id and plain_refresh:
            import hashlib as _hashlib
            effective_user_id = f"user_{_hashlib.sha256(plain_refresh.encode('utf-8')).hexdigest()[:16]}"

        # 25.4.2: Upsert запису в classroom_credentials за парою (group_id, google_user_id)
        if effective_user_id:
            effective_user_id = str(effective_user_id)[:128]
            cred = await db.scalar(
                select(ClassroomCredential).where(
                    ClassroomCredential.group_id == detected_group.id,
                    ClassroomCredential.google_user_id == effective_user_id,
                )
            )
            token_to_store = encrypted_refresh or (encrypt_token(access_token) if access_token else "")
            if cred is None:
                cred = ClassroomCredential(
                    group_id=detected_group.id,
                    google_user_id=effective_user_id,
                    refresh_token=token_to_store,
                    last_synced_at=now_utc,
                    last_error=None,
                    fail_count=0,
                    next_attempt_at=None,
                    is_active=True,
                )
                db.add(cred)
            else:
                if encrypted_refresh or not cred.refresh_token:
                    cred.refresh_token = token_to_store
                cred.last_synced_at = now_utc
                cred.last_error = None
                cred.fail_count = 0
                cred.next_attempt_at = None
                cred.is_active = True

            # Якщо існував тимчасовий запис міграції legacy_group_{id} з тим самим токеном — прибираємо дубль
            legacy_cred = await db.scalar(
                select(ClassroomCredential).where(
                    ClassroomCredential.group_id == detected_group.id,
                    ClassroomCredential.google_user_id == f"legacy_group_{detected_group.id}",
                )
            )
            if legacy_cred and legacy_cred.google_user_id != effective_user_id:
                if plain_refresh and decrypt_token(legacy_cred.refresh_token) == plain_refresh:
                    await db.delete(legacy_cred)

        await db.commit()

        _sync_backoff_state.pop(detected_group.id, None)

        return {
            "group_id": detected_group.id,
            "group_name": detected_group.name,
            "course_name": binding.course_name,
            "last_synced_at": binding.last_synced_at.isoformat() if binding.last_synced_at else now_utc.isoformat(),
            "access_token": access_token,
            "refresh_token": plain_refresh or refresh_token,
            **stats,
            "google_user_id": effective_user_id,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Classroom sync error: {_sanitize_error_msg(traceback.format_exc())}")
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Помилка синхронізації Classroom: {_sanitize_error_msg(str(exc))}",
        )


@router.post("/disconnect")
async def disconnect_classroom_account(
    payload: ClassroomDisconnectRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    25.6: «Від'єднати» видаляє запис цього студента з classroom_credentials
    і відкликає його токен у Google. Інші записи групи не зачіпаються.
    """
    target_user_id = (payload.google_user_id or "").strip() or None
    plain_rt = decrypt_token(payload.refresh_token) if payload.refresh_token else ""
    plain_at = decrypt_token(payload.access_token) if payload.access_token else ""

    if not target_user_id and plain_at:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                me_resp = await client.get(
                    "https://classroom.googleapis.com/v1/userProfiles/me",
                    headers={"Authorization": f"Bearer {plain_at}"},
                )
                if me_resp.status_code == 200:
                    me_data = me_resp.json()
                    target_user_id = str(me_data.get("id") or me_data.get("emailAddress") or "").strip() or None
        except Exception as exc:
            logger.warning(f"Disconnect profile lookup failed: {_sanitize_error_msg(str(exc))}")

    query = select(ClassroomCredential)
    if payload.group_id:
        query = query.where(ClassroomCredential.group_id == payload.group_id)
    candidates = (await db.scalars(query)).all()

    to_delete: list[ClassroomCredential] = []
    tokens_to_revoke: set[str] = set()
    if plain_rt:
        tokens_to_revoke.add(plain_rt)
    if plain_at:
        tokens_to_revoke.add(plain_at)

    for cred in candidates:
        cred_rt = decrypt_token(cred.refresh_token)
        if target_user_id and cred.google_user_id == target_user_id:
            to_delete.append(cred)
            if cred_rt:
                tokens_to_revoke.add(cred_rt)
        elif plain_rt and cred_rt and cred_rt == plain_rt:
            to_delete.append(cred)
            tokens_to_revoke.add(cred_rt)

    deleted_count = 0
    for cred in to_delete:
        await db.delete(cred)
        deleted_count += 1

    await db.commit()

    revoked = False
    if tokens_to_revoke:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for tok in tokens_to_revoke:
                try:
                    rev_resp = await client.post(
                        "https://oauth2.googleapis.com/revoke",
                        params={"token": tok},
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )
                    if rev_resp.status_code == 200:
                        revoked = True
                except Exception as exc:
                    logger.warning(f"Google token revoke warning: {_sanitize_error_msg(str(exc))}")

    return {
        "status": "disconnected",
        "deleted_credentials": deleted_count,
        "revoked": revoked,
    }


async def run_background_sync_task(group_id: int) -> None:
    """Неблокуюча фонова задача синхронізації у власній сесії БД."""
    async with async_session_factory() as db:
        await trigger_background_sync_if_needed(db, group_id)


import time as _time

# (group_id -> (consecutive_failures, next_allowed_monotonic_ts))
_sync_backoff_state: dict[int, tuple[int, float]] = {}
_latest_unmapped_tasks: dict[int, list[dict]] = {}
_latest_group_tasks: dict[int, list[dict]] = {}
_latest_scope_missing: dict[int, bool] = {}
_SYNC_LOCK_GROUPS: set[int] = set()

# In-memory throttle for request-triggered syncs: avoids opening a DB session
# (and a second pooled connection) on every public schedule GET.
_REQUEST_TRIGGER_INTERVAL = 900.0
_last_request_trigger: dict[int, float] = {}


def should_trigger_background_sync(group_id: Optional[int]) -> bool:
    """Cheap, DB-free check whether a public request may schedule a Classroom sync."""
    if not group_id or group_id in _SYNC_LOCK_GROUPS:
        return False
    now_mono = _time.monotonic()
    if now_mono < _sync_backoff_state.get(group_id, (0, 0.0))[1]:
        return False
    if now_mono - _last_request_trigger.get(group_id, -_REQUEST_TRIGGER_INTERVAL) < _REQUEST_TRIGGER_INTERVAL:
        return False
    _last_request_trigger[group_id] = now_mono
    return True


def _apply_credential_backoff(cred: ClassroomCredential, err_msg: str, now: datetime) -> None:
    cred.fail_count = (cred.fail_count or 0) + 1
    delay_seconds = min(14400.0, 900.0 * (2 ** min(cred.fail_count, 4)))
    cred.next_attempt_at = now + timedelta(seconds=delay_seconds)
    cred.last_error = _sanitize_error_msg(err_msg)


async def trigger_background_sync_if_needed(
    db: AsyncSession,
    group_id: Optional[int],
    max_accounts: int = MAX_ACCOUNTS_PER_CYCLE,
    force: bool = False,
) -> None:
    if not group_id or group_id in _SYNC_LOCK_GROUPS:
        return

    now_mono = _time.monotonic()
    failures, next_allowed = _sync_backoff_state.get(group_id, (0, 0.0))
    if not force and now_mono < next_allowed:
        return

    _SYNC_LOCK_GROUPS.add(group_id)
    try:
        group = await db.get(Group, group_id)
        if not group:
            return

        now = datetime.now(timezone.utc)

        # Перевіряємо наявність записів у новій таблиці classroom_credentials
        all_creds = (
            await db.scalars(
                select(ClassroomCredential).where(ClassroomCredential.group_id == group_id)
            )
        ).all()

        binding = await db.scalar(
            select(ClassroomGroupBinding).where(
                ClassroomGroupBinding.group_id == group_id,
                ClassroomGroupBinding.is_active.is_(True),
            )
        )

        if all_creds:
            # 25.5: Беремо активні записи групи, для яких настав час спроби,
            # відсортовані за last_synced_at (найстаріший першим, NULLS FIRST).
            def _is_ready(c: ClassroomCredential) -> bool:
                if not c.is_active:
                    return False
                if force or c.next_attempt_at is None:
                    return True
                na = c.next_attempt_at if c.next_attempt_at.tzinfo else c.next_attempt_at.replace(tzinfo=timezone.utc)
                return na <= now

            active_creds = [c for c in all_creds if _is_ready(c)]
            if not active_creds:
                return

            def _cred_sort_key(c: ClassroomCredential):
                if c.last_synced_at is None:
                    return (0, datetime.min.replace(tzinfo=timezone.utc), c.id or 0)
                ts = c.last_synced_at if c.last_synced_at.tzinfo else c.last_synced_at.replace(tzinfo=timezone.utc)
                return (1, ts, c.id or 0)

            active_creds.sort(key=_cred_sort_key)

            # Якщо навіть найстаріший акаунт синхронізувався менше 15 хв тому (і не force) — пропускаємо
            oldest = active_creds[0]
            if not force and oldest.last_synced_at is not None:
                oldest_ts = oldest.last_synced_at if oldest.last_synced_at.tzinfo else oldest.last_synced_at.replace(tzinfo=timezone.utc)
                if (now - oldest_ts).total_seconds() < 900:
                    return

            selected_creds = active_creds[:max(1, max_accounts)]
            seen_course_ids: set[str] = set()
            any_synced = False

            for cred in selected_creds:
                fresh_token, err_msg, status_code = await _refresh_google_token_detailed(cred.refresh_token)
                if not fresh_token:
                    if err_msg and err_msg.startswith("invalid_grant"):
                        # 25.5: Помилка invalid_grant деактивує лише цей запис і пише last_error
                        cred.is_active = False
                        cred.fail_count = (cred.fail_count or 0) + 1
                        cred.last_error = _sanitize_error_msg(err_msg)
                        cred.next_attempt_at = None
                    else:
                        _apply_credential_backoff(cred, err_msg or f"refresh_failed_{status_code}", now)
                    await db.flush()
                    continue

                headers = {"Authorization": f"Bearer {fresh_token}"}
                try:
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        courses_resp = await client.get(
                            "https://classroom.googleapis.com/v1/courses",
                            params={"courseStates": "ACTIVE", "pageSize": 100},
                            headers=headers,
                        )
                except Exception as req_exc:
                    _apply_credential_backoff(cred, f"network_error: {req_exc}", now)
                    await db.flush()
                    continue

                if courses_resp.status_code in (401, 403, 429):
                    _apply_credential_backoff(
                        cred,
                        f"courses_http_{courses_resp.status_code}",
                        now,
                    )
                    await db.flush()
                    continue
                if courses_resp.status_code != 200:
                    _apply_credential_backoff(
                        cred,
                        f"courses_http_{courses_resp.status_code}",
                        now,
                    )
                    await db.flush()
                    continue

                courses = courses_resp.json().get("courses", [])
                sync_res = await perform_course_sync(
                    db,
                    group,
                    courses,
                    fresh_token,
                    group_course_id=binding.course_id if binding else None,
                    skip_course_ids=seen_course_ids,
                )
                for cid in sync_res.get("synced_course_ids", []):
                    seen_course_ids.add(str(cid))
                for c_obj in courses:
                    if c_obj.get("id"):
                        seen_course_ids.add(str(c_obj["id"]))

                cred.last_synced_at = now
                cred.fail_count = 0
                cred.last_error = None
                cred.next_attempt_at = None
                any_synced = True
                await db.flush()

            if any_synced and binding:
                binding.last_synced_at = now
            await db.commit()
            if any_synced:
                _sync_backoff_state.pop(group_id, None)
            return

        # 25.8.1: Фолбек на стару таблицю classroom_group_bindings, якщо у новій ще немає записів
        if not binding:
            return

        if not force and binding.last_synced_at:
            b_ts = binding.last_synced_at if binding.last_synced_at.tzinfo else binding.last_synced_at.replace(tzinfo=timezone.utc)
            if (now - b_ts).total_seconds() < 900:
                return

        token = decrypt_token(binding.access_token) if binding.access_token else None
        if binding.refresh_token:
            fresh = await _refresh_google_token(binding.refresh_token)
            if fresh:
                token = fresh
                binding.access_token = encrypt_token(fresh)[:512]
            elif not token:
                new_fails = failures + 1
                delay = min(14400.0, 900.0 * (2 ** min(new_fails, 4)))
                _sync_backoff_state[group_id] = (new_fails, _time.monotonic() + delay)
                return

        if not token:
            return

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            courses_resp = await client.get(
                "https://classroom.googleapis.com/v1/courses",
                params={"courseStates": "ACTIVE", "pageSize": 100},
                headers=headers,
            )
            if courses_resp.status_code in (401, 403, 429):
                new_fails = failures + 1
                delay = min(14400.0, 900.0 * (2 ** min(new_fails, 4)))
                _sync_backoff_state[group_id] = (new_fails, _time.monotonic() + delay)
                if courses_resp.status_code in (401, 403) and not binding.refresh_token:
                    binding.access_token = None
                    await db.commit()
                return
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
        _sync_backoff_state.pop(group_id, None)
    except Exception as e:
        new_fails = failures + 1
        delay = min(7200.0, 300.0 * (2 ** min(new_fails, 4)))
        _sync_backoff_state[group_id] = (new_fails, _time.monotonic() + delay)
        logger.warning(f"Background Classroom sync failed for group {group_id} (backoff {delay:.0f}s): {_sanitize_error_msg(str(e))}")
        await db.rollback()
    finally:
        _SYNC_LOCK_GROUPS.discard(group_id)


async def _build_group_accounts_summary(db: AsyncSession, group_id: int) -> dict:
    """25.7: Статистика підключених акаунтів групи для адмінки та статусу."""
    creds = (
        await db.scalars(
            select(ClassroomCredential)
            .where(ClassroomCredential.group_id == group_id)
            .order_by(ClassroomCredential.id.asc())
        )
    ).all()

    active_creds = [c for c in creds if c.is_active]
    active_count = len(active_creds)

    # Перевіряємо, чи має група пари з поділом на підгрупи (2 викладачі: second_teacher_id IS NOT NULL)
    subgroup_lessons_count = await db.scalar(
        select(func.count(Schedule.id)).where(
            Schedule.group_id == group_id,
            Schedule.second_teacher_id.is_not(None),
            Schedule.is_active.is_(True),
        )
    ) or 0
    has_subgroups = subgroup_lessons_count > 0

    subgroup_warning: Optional[str] = None
    if active_count == 0:
        subgroup_warning = "Для цієї групи немає жодного активного Classroom-акаунта."
    elif has_subgroups and active_count < 2:
        subgroup_warning = (
            "Група має пари з поділом на підгрупи, але підключено лише 1 активний акаунт. "
            "Для оновлення обох підгруп бажано підключити по одному студенту з кожної підгрупи."
        )

    latest_sync_dt: Optional[datetime] = None
    for c in creds:
        if c.last_synced_at:
            ts = c.last_synced_at if c.last_synced_at.tzinfo else c.last_synced_at.replace(tzinfo=timezone.utc)
            if latest_sync_dt is None or ts > latest_sync_dt:
                latest_sync_dt = ts

    return {
        "connected_accounts_count": active_count,
        "total_accounts_count": len(creds),
        "has_subgroups": has_subgroups,
        "subgroup_warning": subgroup_warning,
        "latest_cred_synced_at": latest_sync_dt.isoformat() if latest_sync_dt else None,
        "accounts": [
            {
                "id": c.id,
                "google_user_id": c.google_user_id,
                "last_synced_at": c.last_synced_at.isoformat() if c.last_synced_at else None,
                "last_error": c.last_error,
                "fail_count": c.fail_count,
                "next_attempt_at": c.next_attempt_at.isoformat() if c.next_attempt_at else None,
                "is_active": c.is_active,
            }
            for c in creds
        ],
    }


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
    accounts_summary = await _build_group_accounts_summary(db, group_id)
    last_synced = (
        accounts_summary["latest_cred_synced_at"]
        or (binding.last_synced_at.isoformat() if (binding and binding.last_synced_at) else None)
    )
    return {
        "course_name": binding.course_name if binding else None,
        "last_synced_at": last_synced,
        **accounts_summary,
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


@router.post("/clear-all-data")
async def clear_all_classroom_data(
    group_id: Optional[int] = None,
    wipe_secret: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Очищає всі Classroom-прив'язки (classroom_group_bindings та classroom_credentials)
    та автоматичні нотатки/посилання/ДЗ.
    Ручні текстові нотатки студентів та викладачів залишаються недоторканими.
    """
    if not settings.wipe_secret or wipe_secret != settings.wipe_secret:
        raise HTTPException(status_code=403, detail="Невірний секрет очищення")

    # 1. Видаляємо зв'язки
    binding_stmt = delete(ClassroomGroupBinding)
    cred_stmt = delete(ClassroomCredential)
    if group_id:
        binding_stmt = binding_stmt.where(ClassroomGroupBinding.group_id == group_id)
        cred_stmt = cred_stmt.where(ClassroomCredential.group_id == group_id)
    binding_res = await db.execute(binding_stmt)
    await db.execute(cred_stmt)
    deleted_bindings = binding_res.rowcount or 0

    # 2. Очищаємо всі автоматичні нотатки [TASK], посилання Meet/Zoom
    notes_query = select(LessonOccurrenceNote).where(LessonOccurrenceNote.archived.is_(False))
    if group_id:
        notes_query = notes_query.where(LessonOccurrenceNote.group_id == group_id)
    notes = (await db.scalars(notes_query)).all()

    cleaned_notes_count = 0
    archived_notes_count = 0

    for gn in notes:
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
                cleaned_notes_count += 1
        else:
            gn.archived = True
            gn.revision += 1
            gn.updated_at = datetime.now(timezone.utc)
            archived_notes_count += 1

    await db.commit()
    return {
        "status": "success",
        "deleted_bindings": deleted_bindings,
        "cleaned_notes": cleaned_notes_count,
        "archived_auto_notes": archived_notes_count,
    }


@router.get("/status")
async def get_classroom_status():
    return {
        "has_client_secret": bool(settings.google_client_secret),
        "client_id": get_google_client_id(),
    }


@router.get("/groups/{group_id}/status")
async def get_classroom_group_status(
    group_id: int,
    db: AsyncSession = Depends(get_db),
):
    binding = await db.scalar(
        select(ClassroomGroupBinding).where(
            ClassroomGroupBinding.group_id == group_id,
            ClassroomGroupBinding.is_active.is_(True),
        )
    )
    accounts_summary = await _build_group_accounts_summary(db, group_id)
    has_active_creds = accounts_summary["connected_accounts_count"] > 0

    tasks = _latest_group_tasks.get(group_id)
    if tasks is None and (binding or has_active_creds):
        notes = (
            await db.scalars(
                select(LessonOccurrenceNote).where(
                    LessonOccurrenceNote.group_id == group_id,
                    LessonOccurrenceNote.archived.is_(False),
                    LessonOccurrenceNote.note.like("%[TASK]%"),
                )
            )
        ).all()
        reconstructed = []
        seen_urls = set()
        for n in notes:
            subj = n.subject_name or (binding.course_name if binding else "Дисципліна")
            for line in n.note.split("\n"):
                line = line.strip()
                if not line.startswith("[TASK"):
                    continue
                raw = line.replace("[TASK]", "").strip()
                parts = raw.split("|")
                if len(parts) < 2:
                    continue
                left_part = parts[0].strip()
                url_part = parts[1].strip()
                if not url_part.startswith("http") or url_part in seen_urls:
                    continue
                seen_urls.add(url_part)

                teacher = None
                rest = left_part
                badge_m = re.match(r"^\[([^\]]+)\]\s*(.*)$", left_part)
                if badge_m:
                    teacher = badge_m.group(1).strip()
                    rest = badge_m.group(2).strip()

                due_match = re.search(r"\(до\s+(\d{1,2})\.(\d{1,2})\)", rest, re.IGNORECASE)
                due_date_iso = None
                if due_match:
                    d_day = int(due_match.group(1))
                    d_month = int(due_match.group(2))
                    cur_year = n.note_date.year if n.note_date else datetime.now(timezone.utc).year
                    due_date_iso = f"{cur_year}-{d_month:02d}-{d_day:02d}"
                    title_clean = re.sub(r"\(до\s+\d{1,2}\.\d{1,2}\)", "", rest, flags=re.IGNORECASE).strip()
                else:
                    title_clean = rest

                reconstructed.append({
                    "id": url_part,
                    "course_id": binding.course_id if binding else "",
                    "course_name": binding.course_name if binding else "",
                    "title": title_clean or "Завдання",
                    "subject": subj,
                    "teacher": teacher,
                    "due_date": due_date_iso,
                    "url": url_part,
                    "alternate_link": url_part,
                    "state": "NEW",
                    "grade": None,
                    "max_points": None,
                })
        _latest_group_tasks[group_id] = reconstructed
        tasks = reconstructed

    last_synced = (
        accounts_summary["latest_cred_synced_at"]
        or (binding.last_synced_at.isoformat() if (binding and binding.last_synced_at) else None)
    )

    return {
        "connected": bool(binding) or has_active_creds,
        "last_synced_at": last_synced,
        "has_refresh_token": bool(binding and binding.refresh_token) or has_active_creds,
        "has_client_secret": bool(settings.google_client_secret),
        "unmapped_tasks": _latest_unmapped_tasks.get(group_id, []),
        "tasks": tasks if tasks is not None else [],
        "needs_reconnect": _latest_scope_missing.get(group_id, False),
        **accounts_summary,
    }


async def sync_all_connected_groups_once() -> dict:
    """Проходить по всіх підключених групах у classroom_credentials та classroom_group_bindings і оновлює їх розклад."""
    synced_groups = []
    async with async_session_factory() as db:
        cred_group_ids = set(
            (
                await db.scalars(
                    select(ClassroomCredential.group_id).where(
                        ClassroomCredential.is_active.is_(True)
                    )
                )
            ).all()
        )
        binding_group_ids = set(
            (
                await db.scalars(
                    select(ClassroomGroupBinding.group_id).where(
                        ClassroomGroupBinding.is_active.is_(True)
                    )
                )
            ).all()
        )
        group_ids = sorted(cred_group_ids | binding_group_ids)

    for gid in group_ids:
        try:
            async with async_session_factory() as db:
                await trigger_background_sync_if_needed(db, gid)
                synced_groups.append(gid)
            await asyncio.sleep(3)  # Пауза між групами для захисту від Google API Rate Limit
        except Exception as e:
            logger.warning(f"Auto-sync skipped for group {gid}: {_sanitize_error_msg(str(e))}")

    return {"checked_groups": len(group_ids), "processed": synced_groups}


async def classroom_auto_sync_loop() -> None:
    """Нескінченний фоновий цикл: автоматично парсить Classroom кожні 10 хвилин."""
    await asyncio.sleep(15)  # Перший запуск через 15 секунд після старту сервера
    while True:
        try:
            await sync_all_connected_groups_once()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Classroom auto-sync loop error: {_sanitize_error_msg(str(e))}")
        await asyncio.sleep(600)  # Перевірка кожні 10 хвилин


@router.post("/sync-all")
async def manual_trigger_sync_all():
    """Ендпоінт для примусового запуску автосинхронізації всіх груп (наприклад, із зовнішнього cron)."""
    return await sync_all_connected_groups_once()

