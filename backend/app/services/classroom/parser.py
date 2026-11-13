import re
from datetime import date, datetime, timedelta
from typing import Optional

from app.models import Group

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
    r"(?:Код(?:\s+доступ[уае]|\s+конференці[їі])?|Passcode|Пароль(?:\s+конференці[їі])?)\s*[:\-]?\s*([A-Za-z0-9_.\-]+)",
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

IGNORE_ROSTER_LINES = {
    "преподаватели", "викладачі", "teachers",
    "учащиеся", "студенти", "здобувачі освіти", "students", "classmates",
    "одногрупники", "однокурсники", "пользователи", "користувачі", "people",
    "додати", "добавить", "пригласить", "запросити", "дія", "действие", "actions",
}

_LINK_PREFIX_RE = re.compile(
    r"^\s*(?:\[([^\]]+)\]|([А-Яа-яІіЇїЄєҐґa-zA-Z0-9'’ʼ\s.\-]{2,30}))\s*[:\-–]?\s*https?://",
    re.IGNORECASE,
)


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
    elif url and "zoom.us" in url.lower() and zoom_pass:
        if "pwd=" not in url.lower():
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}pwd={zoom_pass}"
        elif len(zoom_pass) <= 20:
            url = f"{url} Код доступу: {zoom_pass}"

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
        return t1_clean or (teacher_parts[0].split()[0] if teacher_parts else None)
    if is_subgroup_2 and not is_subgroup_1:
        return t2_clean or (teacher_parts[1].split()[0] if len(teacher_parts) > 1 else None)

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

    # Специфічні корені для англійської (якщо в БД прізвище трохи відрізняється)
    if any("токар" in tok for tok in all_tokens_folded) or "токар" in comb_fold:
        return t1_clean or "Токарєва"
    if any("хочин" in tok for tok in all_tokens_folded) or "хочин" in comb_fold:
        return t2_clean or "Хочинська"

    # Якщо визначити конкретного не вдалося, але це пара з двома викладачами —
    # повертаємо першого викладача, щоб посилання мало префікс і не затерло інші посилання
    return t1_clean or (teacher_parts[0].split()[0] if teacher_parts else None)


def _link_line_prefix(line: str) -> Optional[str]:
    """Прізвище-префікс рядка з посиланням на пару з двома викладачами («Токарєва: https://...»)."""
    m = _LINK_PREFIX_RE.match(line or "")
    if not m:
        return None
    raw = (m.group(1) or m.group(2) or "").strip()
    return raw if raw else None


def _link_line_belongs_to_sync(
    line: str,
    sync_teacher_tokens: set[str],
    synced_subgroups: Optional[set[int]] = None,
) -> bool:
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
        if synced_subgroups and 1 in synced_subgroups and 2 not in synced_subgroups:
            return True
        if synced_subgroups and 2 in synced_subgroups and 1 not in synced_subgroups:
            return False
        return any("токар" in tok for tok in folded_sync)
    if "2підгр" in p or "2group" in p or p.startswith("2"):
        if synced_subgroups and 2 in synced_subgroups and 1 not in synced_subgroups:
            return True
        if synced_subgroups and 1 in synced_subgroups and 2 not in synced_subgroups:
            return False
        return any("хочин" in tok for tok in folded_sync)

    return any(p in tok or (len(tok) >= 4 and tok in p) for tok in folded_sync)


def _task_line_belongs_to_sync(
    line: str,
    task_c_id: Optional[str],
    current_sync_course_ids: set[str],
    sync_teacher_tokens: set[str],
    synced_subgroups: Optional[set[int]] = None,
) -> bool:
    """Чи належить рядок [TASK] викладачу з курсів ПОТОЧНОГО синку.

    Якщо рядок має бейдж викладача ([TASK] [Токарєва] ...), перевіряємо,
    чи належить цей викладач до активних викладачів поточного синку студента.
    Інакше це завдання іншої підгрупи (навіть зі спільного курсу!), і його треба зберегти.
    """
    badge_m = re.match(r"^\[TASK\]\s*\[([^\]]+)\]", (line or "").strip())
    if badge_m:
        badge_raw = badge_m.group(1).strip()
        p = _fold(badge_raw)
        if len(p) >= 3:
            folded_sync = {_fold(tok) for tok in sync_teacher_tokens if tok}
            if "1підгр" in p or "1group" in p or p.startswith("1"):
                if synced_subgroups and 1 in synced_subgroups and 2 not in synced_subgroups:
                    return True
                if synced_subgroups and 2 in synced_subgroups and 1 not in synced_subgroups:
                    return False
                return any("токар" in tok for tok in folded_sync)
            if "2підгр" in p or "2group" in p or p.startswith("2"):
                if synced_subgroups and 2 in synced_subgroups and 1 not in synced_subgroups:
                    return True
                if synced_subgroups and 1 in synced_subgroups and 2 not in synced_subgroups:
                    return False
                return any("хочин" in tok for tok in folded_sync)
            return any(p in tok or (len(tok) >= 4 and tok in p) for tok in folded_sync)
    if task_c_id and task_c_id in current_sync_course_ids:
        return True
    return False
