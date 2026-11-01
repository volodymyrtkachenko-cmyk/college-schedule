"""Побудова та розв'язання CP-SAT моделі розкладу (без залежності від БД).

Вхід — будь-які об'єкти з полями Curriculum / TeacherConstraint, тому модуль
легко тестується на синтетичних даних.
"""
from dataclasses import dataclass, field
import json
import math
import os
import threading
import time
from pathlib import Path
from typing import Iterable

from ortools.sat.python import cp_model

DAYS = 5                    # Пн..Пт
WEEKS = 2                   # чисельник + знаменник
SLOTS = 4                   # пар на день (1..4)
DAY_IDXS = DAYS * WEEKS     # d = 0..9 (0..4 чисельник, 5..9 знаменник)

MAX_PAIRS_PER_DAY = SLOTS
MIN_PAIRS_PER_DAY = 3  # Kept for compatibility with diagnostics and callers.
REDUCED_MIN_PAIRS_PER_DAY = 2  # Allowed for groups with total load < 32 pairs / 2 weeks.
STANDARD_LOAD_THRESHOLD = 32   # Groups with < 32 pairs / 2 weeks may have 2-pair days.
DEFAULT_NUM_WORKERS = 8
DEFAULT_SOLVE_TIME_SECONDS = 300
FEASIBILITY_TIME_FRACTION = 0.9
FEASIBILITY_RESTARTS = 2
FIRST_ATTEMPT_TIME_FRACTION = 0.8
# Upper bound for the preference-optimisation phase when callers do not
# specify one explicitly (kept small for backwards-compatible behaviour).
DEFAULT_OPTIMIZATION_SECONDS = 60.0


@dataclass(frozen=True)
class SolverWeights:
    """Penalty weights of the soft criteria (0 disables a criterion).

    Defaults reproduce the historically hard-coded values. The dataclass is
    module-level and frozen, so it pickles cleanly into the solver subprocess.
    """

    teacher_windows: int = 250            # «вікно» викладача між двома парами
    late_start: int = 50                  # день групи починається з 2-ї пари
    three_consecutive_days: int = 2_000   # предмет три дні поспіль
    subject_week_balance: int = 10_000    # дисбаланс предмета чисельник/знаменник
    group_week_balance: int = 100_000     # дисбаланс навантаження групи по тижнях
    soft_teacher_constraints: int = 500   # пара в небажаний для викладача слот
    subject_slot_symmetry: int = 500      # симетрія предмета (той самий день і пара в обидва тижні)
    teacher_active_day: int = 120         # компактність днів викладача («методичний день»)
    shared_room_conflict: int = 10        # одночасне використання спільного кабінету/лабораторії
    teacher_single_lesson_day: int = 1200 # одна пара викладача в день (при навантаженні >= 2 пар на тиждень)
    teacher_four_lessons_day: int = 120   # 4 пари поспіль у викладача в один день без перерви
    curator_thursday_priority: int = 1000 # предмет куратора у своїй групі в четвер (пріоритет перед Виховною годиною)


    @classmethod
    def coerce(cls, value: "SolverWeights | dict | None") -> "SolverWeights":
        if value is None:
            return cls()
        if isinstance(value, cls):
            return value
        known = {name: max(0, int(value[name])) for name in cls.__dataclass_fields__ if name in value}
        return cls(**known)


def _cgroup_cpu_quota() -> float | None:
    try:
        with open("/sys/fs/cgroup/cpu.max", encoding="ascii") as quota_file:
            quota, period = quota_file.read().split()
        if quota != "max":
            return int(quota) / int(period)
    except (OSError, ValueError, ZeroDivisionError):
        pass

    try:
        with open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", encoding="ascii") as quota_file:
            quota = int(quota_file.read())
        with open("/sys/fs/cgroup/cpu/cpu.cfs_period_us", encoding="ascii") as period_file:
            period = int(period_file.read())
        if quota > 0 and period > 0:
            return quota / period
    except (OSError, ValueError, ZeroDivisionError):
        pass
    return None


def effective_cpu_count() -> int:
    counts = [os.cpu_count() or 1]
    try:
        counts.append(len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        pass
    quota = _cgroup_cpu_quota()
    if quota is not None:
        counts.append(max(1, math.floor(quota)))
    return max(1, min(counts))


def selected_worker_count(requested: int = DEFAULT_NUM_WORKERS) -> int:
    return max(min(2, requested), min(requested, effective_cpu_count()))

# Preferred patterns retained as a public compatibility/diagnostic value.  The
# default model now expresses their hard part directly with Boolean logic.
VALID_PATTERNS = [
    ((1, 1, 1, 0), 0),    # 3 пари з 1-ї — ідеал
    ((1, 1, 1, 1), 5),    # 4 пари
    ((0, 1, 1, 1), 40),   # 3 пари з 2-ї — лише якщо інакше не виходить
]


def _schedule_hint_assignments(
    curriculums: Iterable,
    path: str | os.PathLike[str] | None = None,
    extra_hints: Iterable[tuple[int, int, int]] | None = None,
    read_files: bool = True,
) -> set[tuple[int, int, int]]:
    """Read optional ``schedule.json`` hints without making them a dependency."""
    by_id = {c.id: c for c in curriculums}
    result: set[tuple[int, int, int]] = set()
    if extra_hints:
        for item in extra_hints:
            try:
                c_id, day, slot = int(item[0]), int(item[1]), int(item[2])
                if c_id in by_id and 0 <= day < DAY_IDXS and 0 <= slot < SLOTS:
                    result.add((c_id, day, slot))
            except (IndexError, TypeError, ValueError):
                continue
    if not read_files:
        return result
    candidates = [Path(path)] if path else [
        Path(os.environ["SCHEDULE_HINT_PATH"]) if os.environ.get("SCHEDULE_HINT_PATH") else None,
        Path.cwd() / "schedule.json",
        Path(__file__).resolve().parents[2] / "schedule.json",
    ]
    for candidate in candidates:
        if candidate is None or not candidate.is_file():
            continue
        try:
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        rows = payload.get("assignments", payload) if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            continue
        by_key: dict[tuple[int, int, int], list[int]] = {}
        for c in curriculums:
            by_key.setdefault((c.group_id, c.teacher_id, c.subject_id), []).append(c.id)
        for row in rows:
            if isinstance(row, (list, tuple)) and len(row) == 3:
                curriculum_id, day, slot = row
            elif isinstance(row, dict):
                curriculum_id = row.get("curriculum_id", row.get("curriculumId"))
                day = row.get("day_idx")
                slot = row.get("slot_idx")
                if curriculum_id is None and {
                    "group_id", "teacher_id", "subject_id"
                }.issubset(row):
                    matches = by_key.get(
                        (row["group_id"], row["teacher_id"], row["subject_id"]), []
                    )
                    curriculum_id = next(
                        (candidate for candidate in matches if candidate in by_id),
                        None,
                    )
                if day is None and row.get("day_of_week") is not None:
                    day = int(row["day_of_week"]) - 1
                    if row.get("week_type") == "denominator":
                        day += DAYS
                if slot is None and row.get("lesson_number") is not None:
                    slot = int(row["lesson_number"]) - 1
            else:
                continue
            try:
                if int(curriculum_id) in by_id and 0 <= int(day) < DAY_IDXS and 0 <= int(slot) < SLOTS:
                    result.add((int(curriculum_id), int(day), int(slot)))
            except (TypeError, ValueError):
                continue
        return result
    return result

# Старі шаблони (для порівняння/діагностики): дозволяли вихідний та 2 пари.
LEGACY_PATTERNS = [
    ((0, 0, 0, 0), 30),
    ((1, 1, 1, 1), 5),
    ((1, 1, 1, 0), 0),
    ((1, 1, 0, 0), 20),
    ((0, 1, 1, 1), 40),
]


@dataclass
class SolveResult:
    status: str                                  # OPTIMAL / FEASIBLE / INFEASIBLE / ...
    objective: float | None = None
    diagnostics: list[str] = field(default_factory=list)
    # (curriculum_id, day_idx 0..9, slot_idx 0..3)
    assignments: list[tuple[int, int, int]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status in ("OPTIMAL", "FEASIBLE")


def fixed_4th_days(curr_list: Iterable) -> set[int]:
    """Indices of days with a fixed lesson in the fourth period."""
    days: set[int] = set()
    for c in curr_list:
        if not c.is_fixed or not c.strict_day or not c.strict_lesson:
            continue
        if str(SLOTS) not in str(c.strict_lesson):
            continue
        req_week = getattr(c, "require_week", None)
        if req_week == "numerator":
            days.add(c.strict_day - 1)
        elif req_week == "denominator":
            days.add(c.strict_day - 1 + DAYS)
        else:
            days.add(c.strict_day - 1)
            if c.pairs_per_2_weeks >= 2:
                days.add(c.strict_day - 1 + DAYS)
    return set(days)


def _is_curator_course(c) -> bool:
    group = getattr(c, "group", None)
    curator_id = getattr(group, "curator_id", None)
    subject_name = getattr(getattr(c, "subject", None), "name", None)
    return bool(
        curator_id is not None
        and subject_name == "Виховна година"
        and curator_id in (c.teacher_id, getattr(c, "second_teacher_id", None))
    )


def _is_curator_hour(c) -> bool:
    return bool(
        _is_curator_course(c)
        and c.is_fixed
        and c.strict_day == 4
        and c.strict_lesson == SLOTS
        and c.pairs_per_2_weeks == WEEKS
        and getattr(c, "require_week", None) is None
    )


def precheck(
    curriculums: Iterable,
    constraints: Iterable = (),
    teacher_names: dict[int, str] | None = None,
) -> list[str]:
    """Швидка перевірка навантаження ДО запуску солвера.

    Повертає список зрозумілих причин, через які розклад гарантовано неможливий.
    """
    curriculums = list(curriculums)
    problems: list[str] = []

    by_group: dict[int, list] = {}
    for c in curriculums:
        by_group.setdefault(c.group_id, []).append(c)

    for g_id, lst in sorted(by_group.items()):
        total = sum(c.pairs_per_2_weeks for c in lst)
        fixed4_days = fixed_4th_days(lst)
        n_fixed4 = len(fixed4_days)
        min_per_day = (
            REDUCED_MIN_PAIRS_PER_DAY
            if total < STANDARD_LOAD_THRESHOLD
            else MIN_PAIRS_PER_DAY
        )
        fixed4_extra_per_day = SLOTS - min_per_day
        # Every group studies each weekday; fixed fourth-period lessons consume
        # additional slots because that day must contain four contiguous lessons.
        lo = min_per_day * DAY_IDXS + n_fixed4 * fixed4_extra_per_day
        hi = MAX_PAIRS_PER_DAY * DAY_IDXS
        if total < lo:
            extra = f" (закріплені 4-ті пари потребують повного дня)" if n_fixed4 else ""
            # Спроба отримати ім'я групи для гарного виведення
            g_name = getattr(lst[0], "group", None)
            g_name_str = g_name.name if g_name else f"id={g_id}"
            
            problems.append(
                f"група [{g_name_str}]: {total} пар/2 тижні, потрібно щонайменше {lo}{extra} — бракує {lo - total}"
            )
        elif total > hi:
            g_name = getattr(lst[0], "group", None)
            g_name_str = g_name.name if g_name else f"id={g_id}"
            problems.append(
                f"група [{g_name_str}]: {total} пар/2 тижні, максимум {hi} — зайвих {total - hi}"
            )

        # Check each week separately: total semester load can look sufficient
        # while week-pinned subjects leave one week below its daily minimum.
        weekly_min = [0, 0]
        weekly_max = [0, 0]
        for c in lst:
            pairs = c.pairs_per_2_weeks
            req_week = getattr(c, "require_week", None)
            if req_week == "numerator":
                weekly_min[0] += pairs
                weekly_max[0] += pairs
            elif req_week == "denominator":
                weekly_min[1] += pairs
                weekly_max[1] += pairs
            else:
                weekly_max[0] += pairs
                weekly_max[1] += pairs
        group = getattr(lst[0], "group", None)
        name = group.name if group else f"id={g_id}"
        curator_courses = [c for c in lst if _is_curator_course(c)]
        if group and group.curator_id is not None:
            if len(curator_courses) != 1:
                problems.append(
                    f"група [{name}]: потрібен рівно один предмет «Виховна година» "
                    "з викладачем-куратором, закріплений на четверту пару четверга"
                )
            for c in curator_courses:
                if not _is_curator_hour(c):
                    problems.append(
                        f"група [{name}]: «Виховна година» має бути рівно 2 пари за 2 тижні, "
                        "закріплена на четверту пару четверга в обох тижнях і вестися куратором"
                    )
        curator_slots_by_week = [
            any(_is_curator_hour(c) for c in lst)
            for week in range(WEEKS)
        ]
        max_total = sum(19 + int(has_hour) for has_hour in curator_slots_by_week)
        if total > max_total and total <= hi:
            problems.append(
                f"група [{name}]: {total} пар/2 тижні, але через резерв четвертої пари четверга "
                f"доступно максимум {max_total} — зайвих {total - max_total}"
            )
        for week in range(WEEKS):
            required = min_per_day * DAYS + sum(
                (day // DAYS == week) * fixed4_extra_per_day for day in fixed4_days
            )
            available_max = 19 + int(curator_slots_by_week[week])
            if weekly_max[week] < required:
                problems.append(
                    f"група [{name}]: у {('чисельнику', 'знаменнику')[week]} "
                    f"максимум {weekly_max[week]} пар, потрібно щонайменше {required} — "
                    f"бракує {required - weekly_max[week]}"
                )
            elif weekly_min[week] > available_max:
                problems.append(
                    f"група [{name}]: у {('чисельнику', 'знаменнику')[week]} "
                    f"щонайменше {weekly_min[week]} пар, але доступно максимум {available_max} — "
                    f"перевантаження на {weekly_min[week] - available_max}"
                )

        for c in lst:
            if c.is_fixed and c.strict_day and c.strict_lesson and c.strict_lesson > SLOTS:
                slots = [slot for slot in str(c.strict_lesson) if slot in "1234"]
                req_week = getattr(c, "require_week", None)
                weeks = 1 if req_week in ("numerator", "denominator") or c.pairs_per_2_weeks < 2 else 2
                expected = len(slots) * weeks
                if not slots or len(set(slots)) != len(slots) or c.pairs_per_2_weeks != expected:
                    problems.append(
                        f"група [{name}]: закріплений блок curriculum {c.id} задає {expected} пар, "
                        f"але в навантаженні вказано {c.pairs_per_2_weeks}"
                    )
            if (
                c.is_fixed
                and c.strict_day == 4
                and c.strict_lesson
                and "4" in str(c.strict_lesson)
                and not _is_curator_hour(c)
            ):
                problems.append(
                    f"група [{name}]: закріплене заняття curriculum {c.id} займає четверту пару "
                    "четверга, зарезервовану для кураторської години"
                )

    # Викладачі: пари потоку рахуємо один раз
    blocked: dict[int, set[tuple[int, int]]] = {}
    for k in constraints:
        if not getattr(k, "is_hard_constraint", True):
            continue
        for slot_idx in constraint_slot_indices(k):
            blocked.setdefault(k.teacher_id, set()).add((k.day_of_week, slot_idx + 1))
    # Thursday's fourth slot is reserved for curator hour in both weeks.
    curator_ids = {
        group.curator_id
        for c in curriculums
        if (group := getattr(c, "group", None)) is not None and group.curator_id is not None
    }
    for teacher_id in curator_ids:
        blocked.setdefault(teacher_id, set()).add((4, SLOTS))
    load: dict[int, int] = {}
    seen: dict[int, set[str]] = {}
    for c in curriculums:
        for t in filter(None, (c.teacher_id, c.second_teacher_id)):
            if c.is_stream and c.stream_id:
                if c.stream_id in seen.setdefault(t, set()):
                    continue
                seen[t].add(c.stream_id)
            load[t] = load.get(t, 0) + c.pairs_per_2_weeks
    for t, n in sorted(load.items()):
        free = DAY_IDXS * SLOTS - 2 * len(blocked.get(t, ()))
        if n > free:
            name = (teacher_names or {}).get(t)
            label = f"«{name}»" if name else f"id={t}"
            problems.append(
                f"викладач {label}: {n} пар/2 тижні, але вільних слотів лише {free} — перевантаження на {n - free}"
            )
    return problems


_SHARED_MULTI_GROUP_ROOMS = {
    "—",
    "-",
    "онлайн",
    "online",
    "дистанційно",
    "спортивний комплекс",
    "спорткомплекс",
    "спортзал",
    "спортивна зала",
    "актова зала",
    "читальна зала",
    "стадіон",
    "тир",
    "плац",
}


def _extract_curriculum_rooms(c) -> list[str]:
    rooms: list[str] = []
    for raw in (
        getattr(c, "room", None),
        getattr(c, "teacher_room", None),
        getattr(getattr(c, "teacher", None), "room", None),
        getattr(c, "second_teacher_room", None),
        getattr(getattr(c, "second_teacher", None), "room", None),
    ):
        if raw and isinstance(raw, str):
            norm = raw.strip().lower()
            if norm and norm not in _SHARED_MULTI_GROUP_ROOMS:
                if norm not in rooms:
                    rooms.append(norm)
    return rooms


# Якщо за однією базовою аудиторією у довіднику закріплено декількох викладачів
# (кафедральна/циклова аудиторія, як-от 308 або 203), чиє сумарне навантаження перевищує
# фізичний поріг одного кабінету (> 32 пар на 2 тижні при 38 доступних слотах),
# така аудиторія фізично не може вмістити всі їхні пари по черзі й не повинна
# блокувати оптимізацію розкладу або засмічувати звіт фальшивими конфліктами.
_OVERLOADED_SHARED_ROOM_PAIR_THRESHOLD = 32


def _overloaded_multi_teacher_rooms(curriculums: Iterable) -> set[str]:
    room_pairs: dict[str, int] = {}
    room_teachers: dict[str, set[int]] = {}
    seen_streams: dict[str, set[str]] = {}
    for c in curriculums:
        for room_norm in _extract_curriculum_rooms(c):
            for t_id in filter(None, (getattr(c, "teacher_id", None), getattr(c, "second_teacher_id", None))):
                room_teachers.setdefault(room_norm, set()).add(t_id)
            if getattr(c, "is_stream", False) and getattr(c, "stream_id", None):
                s_set = seen_streams.setdefault(room_norm, set())
                if c.stream_id in s_set:
                    continue
                s_set.add(c.stream_id)
            room_pairs[room_norm] = room_pairs.get(room_norm, 0) + int(getattr(c, "pairs_per_2_weeks", 0) or 0)
    return {
        room_norm
        for room_norm, total_pairs in room_pairs.items()
        if len(room_teachers.get(room_norm, ())) >= 2 and total_pairs > _OVERLOADED_SHARED_ROOM_PAIR_THRESHOLD
    }


def constraint_slot_indices(constraint) -> list[int]:
    """0-based slots covered by a teacher constraint (no lesson = whole day)."""
    lesson = getattr(constraint, "lesson_number", None)
    if lesson is None:
        return list(range(SLOTS))
    if 1 <= int(lesson) <= SLOTS:
        return [int(lesson) - 1]
    return []


def _report_progress(
    progress_path: str | os.PathLike[str] | None,
    phase: str,
    progress_percent: int,
    solutions_found: int = 0,
    message: str = "",
) -> None:
    if not progress_path:
        return
    try:
        p = Path(progress_path)
        tmp_p = p.with_suffix(f".tmp_{os.getpid()}")
        payload = json.dumps({
            "phase": phase,
            "progress_percent": progress_percent,
            "solutions_found": solutions_found,
            "message": message,
            "timestamp": time.time(),
        })
        tmp_p.write_text(payload, encoding="utf-8")
        tmp_p.replace(p)
    except Exception:
        pass


def solve(
    curriculums: list,
    constraints: list,
    max_time_in_seconds: float = DEFAULT_SOLVE_TIME_SECONDS,
    num_workers: int = DEFAULT_NUM_WORKERS,
    patterns=None,
    seed: int | None = None,
    hint_path: str | os.PathLike[str] | None = None,
    hints: Iterable[tuple[int, int, int]] | None = None,
    locked_assignments: Iterable[tuple[int, int, int]] | None = None,
    *,
    weights: SolverWeights | dict | None = None,
    optimization_time_seconds: float | None = None,
    use_file_hints: bool = True,
    progress_path: str | os.PathLike[str] | None = None,
) -> SolveResult:
    use_default_patterns = patterns is None
    patterns = VALID_PATTERNS if patterns is None else patterns
    weights = SolverWeights.coerce(weights)
    explicit_optimization_budget = optimization_time_seconds is not None
    if optimization_time_seconds is None:
        optimization_time_seconds = DEFAULT_OPTIMIZATION_SECONDS

    _report_progress(progress_path, "validating", 8, message="Перевірка навчального навантаження")

    # Avoid spending the entire search limit proving simple load contradictions.
    if patterns is VALID_PATTERNS:
        problems = precheck(curriculums, constraints)
        if problems:
            _report_progress(progress_path, "validating", 100, message="Помилка перевірки")
            return SolveResult(status="INFEASIBLE", diagnostics=problems)

    # (teacher_id, day_idx, slot_idx) недоступності. Обмеження діє в обидва тижні.
    invalid_teacher_slots: set[tuple[int, int, int]] = set()
    # Небажані (м'які) слоти викладачів — штрафуються на етапі оптимізації.
    soft_teacher_slots: set[tuple[int, int, int]] = set()
    for c in constraints:
        target = (
            invalid_teacher_slots
            if getattr(c, "is_hard_constraint", True)
            else soft_teacher_slots
        )
        dow_idx = c.day_of_week - 1
        if not 0 <= dow_idx < DAYS:
            continue
        for slot_idx in constraint_slot_indices(c):
            target.add((c.teacher_id, dow_idx, slot_idx))
            target.add((c.teacher_id, dow_idx + DAYS, slot_idx))
    soft_teacher_slots -= invalid_teacher_slots

    # Thursday, period 4 is reserved in both weeks. Curriculum lessons cannot
    # occupy it, and each group's curator is unavailable to teach elsewhere.
    curator_ids_by_group = {
        c.group_id: getattr(getattr(c, "group", None), "curator_id", None)
        for c in curriculums
    }
    curator_unavailable_slots = {
        (teacher_id, day, 3)
        for teacher_id in filter(None, curator_ids_by_group.values())
        for day in (3, 8)
    }

    _report_progress(progress_path, "validating", 12, message="Побудова математичної моделі")
    model = cp_model.CpModel()
    X = {
        (c.id, d, s): model.NewBoolVar(f"X_{c.id}_{d}_{s}")
        for c in curriculums for d in range(DAY_IDXS) for s in range(SLOTS)
    }

    group_curriculums: dict[int, list] = {}
    group_subject_curriculums: dict[tuple[int, int], list] = {}
    teacher_curriculums: dict[int, list] = {}
    streams: dict[str, list] = {}
    for c in curriculums:
        group_curriculums.setdefault(c.group_id, []).append(c)
        subj_key = getattr(c, "subject_id", None)
        if subj_key is not None:
            group_subject_curriculums.setdefault((c.group_id, subj_key), []).append(c)
        teacher_curriculums.setdefault(c.teacher_id, []).append(c)
        if c.second_teacher_id:
            teacher_curriculums.setdefault(c.second_teacher_id, []).append(c)
        if c.is_stream and c.stream_id:
            streams.setdefault(c.stream_id, []).append(c)

    group_pin_slack: dict[int, int] = {}
    for g_id, curr_list in group_curriculums.items():
        pinned_num = sum(
            c.pairs_per_2_weeks
            for c in curr_list
            if getattr(c, "require_week", None) == "numerator"
        )
        pinned_den = sum(
            c.pairs_per_2_weeks
            for c in curr_list
            if getattr(c, "require_week", None) == "denominator"
        )
        group_pin_slack[g_id] = abs(pinned_num - pinned_den)

    unbalanced_curriculums = []
    for c in curriculums:
        all_vars = [X[(c.id, d, s)] for d in range(DAY_IDXS) for s in range(SLOTS)]
        model.Add(sum(all_vars) == c.pairs_per_2_weeks)

        # Explicit week pins are hard; otherwise bound each subject tightly
        # between the numerator and denominator so the two weeks decouple
        # during the feasibility search instead of causing combinatorial blow-up.
        w1 = sum(X[(c.id, d, s)] for d in range(DAYS) for s in range(SLOTS))
        w2 = sum(X[(c.id, d, s)] for d in range(DAYS, DAY_IDXS) for s in range(SLOTS))
        
        req_week = getattr(c, "require_week", None)
        if req_week == "numerator":
            model.Add(w1 == c.pairs_per_2_weeks)
            model.Add(w2 == 0)
        elif req_week == "denominator":
            model.Add(w1 == 0)
            model.Add(w2 == c.pairs_per_2_weeks)
        else:
            slack = (
                max(group_pin_slack[other.group_id] for other in streams[c.stream_id])
                if c.is_stream and c.stream_id and c.stream_id in streams
                else group_pin_slack[c.group_id]
            )
            lo_w1 = max(0, c.pairs_per_2_weeks // 2 - slack)
            hi_w1 = min(c.pairs_per_2_weeks, (c.pairs_per_2_weeks + 1) // 2 + slack)
            model.Add(w1 >= lo_w1)
            model.Add(w1 <= hi_w1)
            if lo_w1 < hi_w1:
                unbalanced_curriculums.append((c, w1, w2))

        # Закріплені пари (Може бути закріплений як конкретний день і пара, так і тільки конкретний день)
        if c.is_fixed and c.strict_day:
            dow_idx = c.strict_day - 1
            req = getattr(c, "require_week", None)
            
            if c.strict_lesson:
                # Якщо це комбінований блок (12, 123, 1234 тощо)
                if c.strict_lesson > 4:
                    slots = [int(char) - 1 for char in str(c.strict_lesson) if char in "1234"]
                    if not slots or len(set(slots)) != len(slots):
                        return SolveResult(status="MODEL_INVALID")
                    if req == "numerator":
                        forced_days = [dow_idx]
                    elif req == "denominator":
                        forced_days = [dow_idx + DAYS]
                    elif c.pairs_per_2_weeks >= 2:
                        forced_days = [dow_idx, dow_idx + DAYS]
                    else:
                        forced_days = [dow_idx]
                    for d in range(DAY_IDXS):
                        for s in range(SLOTS):
                            if d not in forced_days or s not in slots:
                                model.Add(X[(c.id, d, s)] == 0)
                    for fd in forced_days:
                        for s_idx in slots:
                            model.Add(X[(c.id, fd, s_idx)] == 1)
                else:
                    # Звичайна одна пара
                    slot_idx = c.strict_lesson - 1
                    if c.pairs_per_2_weeks == 1:
                        model.Add(X[(c.id, dow_idx, slot_idx)] == 1)
                    elif req == "numerator":
                        model.Add(X[(c.id, dow_idx, slot_idx)] == 1)
                    elif req == "denominator":
                        model.Add(X[(c.id, dow_idx + DAYS, slot_idx)] == 1)
                    elif c.pairs_per_2_weeks >= 2:
                        model.Add(X[(c.id, dow_idx, slot_idx)] == 1)
                        model.Add(X[(c.id, dow_idx + DAYS, slot_idx)] == 1)
            else:
                # Прив'язано ТІЛЬКИ до дня (а пара яка-завгодно). 
                # Усі пари цього предмету мають опинитися САМЕ в цей день! 
                req = getattr(c, "require_week", None)
                expected_w1 = c.pairs_per_2_weeks if req == "numerator" else (0 if req == "denominator" else c.pairs_per_2_weeks // 2)
                expected_w2 = c.pairs_per_2_weeks if req == "denominator" else (0 if req == "numerator" else (c.pairs_per_2_weeks + 1) // 2)
                
                # Додаємо умову, що загальна кількість пар в цей день має дорівнювати очікуваному за тиждень навантаженню
                model.Add(sum(X[(c.id, dow_idx, s)] for s in range(SLOTS)) == expected_w1)
                model.Add(sum(X[(c.id, dow_idx + DAYS, s)] for s in range(SLOTS)) == expected_w2)

        # Не більше 1 такої самої пари на день (якщо не дозволено блокове навчання)
        if not getattr(c, "allow_multiple_per_day", False):
            for d in range(DAY_IDXS):
                model.Add(sum(X[(c.id, d, s)] for s in range(SLOTS)) <= 1)

        # Недоступність викладачів
        curator_hour = _is_curator_hour(c)
        for d in range(DAY_IDXS):
            for s in range(SLOTS):
                # Leave the curator-hour slot clear for ordinary curriculum.
                if d in (3, 8) and s == 3 and not curator_hour:
                    model.Add(X[(c.id, d, s)] == 0)
                reserved_curator_slot = d in (3, 8) and s == 3 and curator_hour
                group_curator_id = getattr(getattr(c, "group", None), "curator_id", None)
                if (c.teacher_id, d, s) in invalid_teacher_slots:
                    model.Add(X[(c.id, d, s)] == 0)
                if c.second_teacher_id and (c.second_teacher_id, d, s) in invalid_teacher_slots:
                    model.Add(X[(c.id, d, s)] == 0)
                if (c.teacher_id, d, s) in curator_unavailable_slots and not (
                    reserved_curator_slot and c.teacher_id == group_curator_id
                ):
                    model.Add(X[(c.id, d, s)] == 0)
                if c.second_teacher_id and (c.second_teacher_id, d, s) in curator_unavailable_slots and not (
                    reserved_curator_slot and c.second_teacher_id == group_curator_id
                ):
                    model.Add(X[(c.id, d, s)] == 0)

    # Якщо у групи є кілька рядків навантаження з тим самим subject_id (напр., лекції + лаби або дубль),
    # не дозволяємо ставити їх в один і той самий день, якщо загальна кількість пар <= 8 і немає блоку.
    for (_g_id, _subj_id), subj_currs in group_subject_curriculums.items():
        if len(subj_currs) > 1:
            total_subj_pairs = sum(sc.pairs_per_2_weeks for sc in subj_currs)
            has_block_flag = any(
                getattr(sc, "allow_multiple_per_day", False)
                or (sc.is_fixed and sc.strict_lesson and sc.strict_lesson > 4)
                for sc in subj_currs
            )
            if not has_block_flag and total_subj_pairs <= 8:
                for d in range(DAY_IDXS):
                    model.Add(
                        sum(X[(sc.id, d, s)] for sc in subj_currs for s in range(SLOTS)) <= 1
                    )

    unbalanced_groups = []
    for g_id, curr_list in group_curriculums.items():
        numerator_load = sum(
            X[(c.id, d, s)]
            for c in curr_list
            for d in range(DAYS)
            for s in range(SLOTS)
        )
        denominator_load = sum(
            X[(c.id, d, s)]
            for c in curr_list
            for d in range(DAYS, DAY_IDXS)
            for s in range(SLOTS)
        )
        group_load = sum(c.pairs_per_2_weeks for c in curr_list)
        pinned_num = sum(
            c.pairs_per_2_weeks
            for c in curr_list
            if getattr(c, "require_week", None) == "numerator"
        )
        pinned_den = sum(
            c.pairs_per_2_weeks
            for c in curr_list
            if getattr(c, "require_week", None) == "denominator"
        )
        if pinned_num <= (group_load + 1) // 2 and pinned_den <= (group_load + 1) // 2:
            model.Add(numerator_load >= group_load // 2)
            model.Add(numerator_load <= (group_load + 1) // 2)
            if group_load % 2 != 0:
                unbalanced_groups.append((g_id, group_load, numerator_load, denominator_load))
        else:
            unbalanced_groups.append((g_id, group_load, numerator_load, denominator_load))

    teacher_slot_vars: dict[tuple[int, int, int], list] = {}
    for teacher_id, curr_list in teacher_curriculums.items():
        for d in range(DAY_IDXS):
            for s in range(SLOTS):
                unique_vars, seen_streams = [], set()
                for c in curr_list:
                    if c.is_stream and c.stream_id:
                        if c.stream_id in seen_streams:
                            continue
                        seen_streams.add(c.stream_id)
                    unique_vars.append(X[(c.id, d, s)])
                teacher_slot_vars[(teacher_id, d, s)] = unique_vars

    for d in range(DAY_IDXS):
        for s in range(SLOTS):
            for curr_list in group_curriculums.values():
                model.AddAtMostOne([X[(c.id, d, s)] for c in curr_list])

            for teacher_id in teacher_curriculums:
                model.AddAtMostOne(teacher_slot_vars[(teacher_id, d, s)])

            for curr_list in streams.values():
                if len(curr_list) > 1:
                    base = curr_list[0]
                    for other in curr_list[1:]:
                        model.Add(X[(base.id, d, s)] == X[(other.id, d, s)])

    fixed4 = {g: fixed_4th_days(lst) for g, lst in group_curriculums.items()}
    day_pattern_penalties = []
    for g_id, curr_list in group_curriculums.items():
        group_load = sum(c.pairs_per_2_weeks for c in curr_list)
        allow_two_pair_days = group_load < STANDARD_LOAD_THRESHOLD
        for d in range(DAY_IDXS):
            slots_active = []
            for s in range(SLOTS):
                a = model.NewBoolVar(f"active_g{g_id}_d{d}_s{s}")
                model.Add(sum(X[(c.id, d, s)] for c in curr_list) == a)
                slots_active.append(a)

            if use_default_patterns:
                if allow_two_pair_days:
                    # Groups with < 32 pairs/2 weeks may also have 2-pair days:
                    # (1,1,0,0) or (0,1,1,0) in addition to 3- and 4-pair days,
                    # always starting from period 1 or 2 and with no windows.
                    model.Add(slots_active[1] == 1)
                    model.Add(slots_active[0] + slots_active[2] >= 1)
                    model.Add(slots_active[3] <= slots_active[2])
                    if weights.late_start:
                        day_pattern_penalties.append((1 - slots_active[0]) * (weights.late_start * 8))
                else:
                    # The three allowed patterns ((1,1,1,0), (1,1,1,1), (0,1,1,1))
                    # are equivalent to slots 2 and 3 always being occupied and at
                    # least one of slots 1 and 4 being occupied.
                    model.Add(slots_active[1] == 1)
                    model.Add(slots_active[2] == 1)
                    model.Add(slots_active[0] + slots_active[3] >= 1)
                    if weights.late_start:
                        day_pattern_penalties.append((1 - slots_active[0]) * (weights.late_start * 8))
            else:
                pattern_vars = []
                for p_idx, (pat, pen) in enumerate(patterns):
                    p = model.NewBoolVar(f"pat_{g_id}_{d}_{p_idx}")
                    pattern_vars.append(p)
                    if pen:
                        day_pattern_penalties.append(p * pen)
                    for s in range(SLOTS):
                        model.Add(slots_active[s] == pat[s]).OnlyEnforceIf(p)
                model.AddExactlyOne(pattern_vars)

            # Виховна година (закріплена 4-та пара) => у цей день рівно 4 пари.
            if d in fixed4[g_id]:
                model.Add(slots_active[0] == 1)
                model.Add(slots_active[1] == 1)
                model.Add(slots_active[2] == 1)
                model.Add(slots_active[3] == 1)

    hint_assignments = _schedule_hint_assignments(
        curriculums, hint_path, hints, read_files=use_file_hints
    )
    by_id = {c.id: c for c in curriculums}
    for c_id, day, slot in locked_assignments or ():
        if c_id in by_id and 0 <= day < DAY_IDXS and 0 <= slot < SLOTS:
            model.Add(X[(c_id, day, slot)] == 1)
    for key, var in X.items():
        if key in hint_assignments:
            model.AddHint(var, 1)

    actual_workers = selected_worker_count(num_workers)

    def new_solver(time_limit: float, random_seed: int | None) -> cp_model.CpSolver:
        instance = cp_model.CpSolver()
        instance.parameters.max_time_in_seconds = max(0.01, time_limit)
        instance.parameters.num_search_workers = actual_workers
        if random_seed is not None:
            instance.parameters.random_seed = random_seed
        return instance

    def add_soft_preference_penalties() -> dict[str, list]:
        penalties = {
            "teacher": [],
            "symmetry": [],
            "group": list(day_pattern_penalties),
            "secondary": [],
        }
        for g_id, group_load, numerator_load, denominator_load in (
            unbalanced_groups if weights.group_week_balance else ()
        ):
            week_difference = model.NewIntVar(
                -group_load,
                group_load,
                f"group_week_difference_g{g_id}",
            )
            week_imbalance = model.NewIntVar(
                0,
                group_load,
                f"group_week_imbalance_g{g_id}",
            )
            model.Add(week_difference == numerator_load - denominator_load)
            model.AddAbsEquality(week_imbalance, week_difference)
            penalties["group"].append(week_imbalance * weights.group_week_balance)

        for c, w1, w2 in (unbalanced_curriculums if weights.subject_week_balance else ()):
            week_difference = model.NewIntVar(
                -c.pairs_per_2_weeks,
                c.pairs_per_2_weeks,
                f"week_difference_c{c.id}",
            )
            week_imbalance = model.NewIntVar(
                0,
                c.pairs_per_2_weeks,
                f"week_imbalance_c{c.id}",
            )
            model.Add(week_difference == w1 - w2)
            model.AddAbsEquality(week_imbalance, week_difference)
            penalties["group"].append(week_imbalance * weights.subject_week_balance)

        for c in (curriculums if weights.three_consecutive_days else ()):
            req_w = getattr(c, "require_week", None)
            # Предмет із 1–2 парами на 2 тижні (без прив'язки до одного тижня) має максимум 1 пару в тиждень —
            # стояти 2 чи 3 дні поспіль в одному тижні він фізично не може.
            if c.pairs_per_2_weeks <= 2 and req_w is None:
                continue
            for week in range(WEEKS):
                week_start = week * DAYS
                daily_active = []
                for weekday in range(DAYS):
                    day_active = model.NewBoolVar(
                        f"active_c{c.id}_d{week_start + weekday}"
                    )
                    model.AddMaxEquality(
                        day_active,
                        [X[(c.id, week_start + weekday, slot)] for slot in range(SLOTS)],
                    )
                    daily_active.append(day_active)
                # Для предметів із 2 парами на тиждень (3..4 пари за 2 тижні) м'яко уникаємо 2 днів поспіль (напр. Чт і Пт)
                if c.pairs_per_2_weeks <= 4 and req_w is None:
                    two_day_weight = max(1, weights.three_consecutive_days // 50)
                    for first_day in range(DAYS - 1):
                        two_consecutive_days = model.NewBoolVar(
                            f"two_consecutive_c{c.id}_w{week}_d{first_day}"
                        )
                        model.AddBoolAnd(
                            daily_active[first_day:first_day + 2]
                        ).OnlyEnforceIf(two_consecutive_days)
                        model.AddBoolOr(
                            [day.Not() for day in daily_active[first_day:first_day + 2]]
                        ).OnlyEnforceIf(two_consecutive_days.Not())
                        penalties["secondary"].append(two_consecutive_days * two_day_weight)
                else:
                    for first_day in range(DAYS - 2):
                        three_consecutive_days = model.NewBoolVar(
                            f"three_consecutive_c{c.id}_w{week}_d{first_day}"
                        )
                        model.AddBoolAnd(
                            daily_active[first_day:first_day + 3]
                        ).OnlyEnforceIf(three_consecutive_days)
                        model.AddBoolOr(
                            [day.Not() for day in daily_active[first_day:first_day + 3]]
                        ).OnlyEnforceIf(three_consecutive_days.Not())
                        penalties["secondary"].append(
                            three_consecutive_days * weights.three_consecutive_days
                        )

        # Небажані слоти викладачів: кожна пара в такому слоті — штраф.
        if weights.soft_teacher_constraints:
            for teacher_id, d, s in sorted(soft_teacher_slots):
                for var in teacher_slot_vars.get((teacher_id, d, s), ()):
                    penalties["secondary"].append(var * weights.soft_teacher_constraints)

        # Teacher gaps and active-day compactness ("methodical day") are soft preferences.
        # Stream copies are counted once because they use one teacher slot.
        if (
            weights.teacher_windows
            or weights.teacher_active_day
            or weights.teacher_single_lesson_day
            or weights.teacher_four_lessons_day
        ):
            all_curator_teacher_ids = set(filter(None, curator_ids_by_group.values()))
            for teacher_id in teacher_curriculums:
                t_currs = [c for c in teacher_curriculums[teacher_id] if not _is_curator_hour(c)]
                busy_days_by_week: dict[int, list] = {0: [], DAYS: []}
                weekly_loads: dict[int, int] = {0: 0, DAYS: 0}
                seen_load_streams: set[str] = set()
                for curriculum in t_currs:
                    stream_key = curriculum.stream_id if curriculum.is_stream and curriculum.stream_id else f"curr:{curriculum.id}"
                    if stream_key in seen_load_streams:
                        continue
                    seen_load_streams.add(stream_key)
                    pairs = max(0, int(curriculum.pairs_per_2_weeks or 0))
                    required_week = getattr(curriculum, "require_week", None)
                    if required_week == "numerator":
                        weekly_loads[0] += pairs
                    elif required_week == "denominator":
                        weekly_loads[DAYS] += pairs
                    else:
                        weekly_loads[0] += (pairs + 1) // 2
                        weekly_loads[DAYS] += pairs // 2
                for d in range(DAY_IDXS):
                    active = []
                    teaching_active = []
                    for s in range(SLOTS):
                        unique_vars = teacher_slot_vars[(teacher_id, d, s)]
                        teacher_active = model.NewBoolVar(f"active_t{teacher_id}_d{d}_s{s}")
                        model.Add(sum(unique_vars) == teacher_active)
                        active.append(teacher_active)
                        is_curator_hr = (d in (3, 8) and s == 3 and teacher_id in all_curator_teacher_ids)
                        if is_curator_hr:
                            teaching_active_var = model.NewBoolVar(
                                f"teaching_active_t{teacher_id}_d{d}_s{s}"
                            )
                            model.Add(teaching_active_var == 0)
                            teaching_active.append(teaching_active_var)
                        else:
                            teaching_active.append(teacher_active)

                    if weights.teacher_windows:
                        for first in range(SLOTS - 2):
                            window = model.NewBoolVar(f"window_t{teacher_id}_d{d}_{first}")
                            model.Add(window <= teaching_active[first])
                            model.Add(window <= teaching_active[first + 2])
                            model.Add(window <= 1 - teaching_active[first + 1])
                            model.Add(
                                window >= teaching_active[first] + teaching_active[first + 2] - teaching_active[first + 1] - 1
                            )
                            penalties["teacher"].append(window * (weights.teacher_windows * 2))
                        # Double window: [1, 0, 0, 1] (lessons 1 and 4 with lessons 2 and 3 empty)
                        if SLOTS >= 4:
                            double_window = model.NewBoolVar(f"double_window_t{teacher_id}_d{d}")
                            model.Add(double_window <= teaching_active[0])
                            model.Add(double_window <= teaching_active[3])
                            model.Add(double_window <= 1 - teaching_active[1])
                            model.Add(double_window <= 1 - teaching_active[2])
                            model.Add(
                                double_window >= teaching_active[0] + teaching_active[3] - teaching_active[1] - teaching_active[2] - 1
                            )
                            penalties["teacher"].append(double_window * (weights.teacher_windows * 8))

                    if weights.teacher_single_lesson_day:
                        week_start = 0 if d < DAYS else DAYS
                        # Reuse the already-created day variables when deciding
                        # whether this teacher has at least two lessons that week.
                        # The weekly load is intentionally based on actual model
                        # variables; floor(pairs / 2) incorrectly disabled this
                        # penalty for teachers teaching several one-pair subjects.
                        week_load_expr = sum(
                            sum(teacher_slot_vars[(teacher_id, week_day, week_slot)])
                            for week_day in range(week_start, week_start + DAYS)
                            for week_slot in range(SLOTS)
                        )
                        week_has_multi = model.NewBoolVar(
                            f"week_has_multi_t{teacher_id}_{week_start}"
                        )
                        model.Add(week_load_expr >= 2).OnlyEnforceIf(week_has_multi)
                        model.Add(week_load_expr <= 1).OnlyEnforceIf(week_has_multi.Not())
                        day_single = model.NewBoolVar(f"single_candidate_t{teacher_id}_d{d}")
                        model.Add(sum(teaching_active) == 1).OnlyEnforceIf(day_single)
                        model.Add(sum(teaching_active) != 1).OnlyEnforceIf(day_single.Not())
                        single_day = model.NewBoolVar(f"single_day_t{teacher_id}_d{d}")
                        model.AddBoolAnd([day_single, week_has_multi]).OnlyEnforceIf(single_day)
                        model.AddBoolOr([day_single.Not(), week_has_multi.Not()]).OnlyEnforceIf(single_day.Not())
                        penalties["teacher"].append(single_day * weights.teacher_single_lesson_day)

                    if weights.teacher_four_lessons_day:
                        four_day = model.NewBoolVar(f"four_day_t{teacher_id}_d{d}")
                        model.Add(sum(teaching_active) == 4).OnlyEnforceIf(four_day)
                        model.Add(sum(teaching_active) != 4).OnlyEnforceIf(four_day.Not())
                        penalties["teacher"].append(four_day * weights.teacher_four_lessons_day)

                    if weights.teacher_active_day:
                        day_busy = model.NewBoolVar(f"day_busy_t{teacher_id}_d{d}")
                        model.AddMaxEquality(day_busy, teaching_active)
                        penalties["teacher"].append(day_busy * weights.teacher_active_day)
                        busy_days_by_week[0 if d < DAYS else DAYS].append(day_busy)

                # Penalize only days beyond the theoretical minimum needed for
                # this teacher's weekly load. This targets scattered one-pair
                # days while allowing a legitimate 2-day schedule for heavier
                # teachers.
                if weights.teacher_active_day:
                    for week_start, busy_days in busy_days_by_week.items():
                        minimum_days = math.ceil(weekly_loads[week_start] / SLOTS)
                        excess_days = model.NewIntVar(
                            0,
                            DAYS,
                            f"excess_active_days_t{teacher_id}_w{week_start}",
                        )
                        model.AddMaxEquality(
                            excess_days,
                            [0, sum(busy_days) - minimum_days],
                        )
                        penalties["teacher"].append(excess_days * weights.teacher_active_day)

        # Предмет куратора у своїй групі у четвер (пріоритет на 3-тю пару перед Виховною годиною)
        if weights.curator_thursday_priority:
            for g_id, c_list in group_curriculums.items():
                c_id = curator_ids_by_group.get(g_id)
                if not c_id:
                    continue
                curator_teaching_currs = [
                    c for c in c_list
                    if not _is_curator_hour(c) and (c.teacher_id == c_id or c.second_teacher_id == c_id)
                ]
                if not curator_teaching_currs:
                    continue
                for d in (3, 8):
                    w_name = "numerator" if d < DAYS else "denominator"
                    valid_currs = [
                        c for c in curator_teaching_currs
                        if getattr(c, "require_week", None) in (None, w_name)
                    ]
                    if not valid_currs:
                        continue
                    p3_vars = [X[(c.id, d, 2)] for c in valid_currs]
                    has_curator_p3 = model.NewBoolVar(f"curator_p3_g{g_id}_d{d}")
                    model.Add(sum(p3_vars) >= 1).OnlyEnforceIf(has_curator_p3)
                    model.Add(sum(p3_vars) == 0).OnlyEnforceIf(has_curator_p3.Not())
                    penalties["secondary"].append((1 - has_curator_p3) * weights.curator_thursday_priority)

                    p2_vars = [X[(c.id, d, 1)] for c in valid_currs]
                    has_curator_p2 = model.NewBoolVar(f"curator_p2_g{g_id}_d{d}")
                    model.Add(sum(p2_vars) >= 1).OnlyEnforceIf(has_curator_p2)
                    model.Add(sum(p2_vars) == 0).OnlyEnforceIf(has_curator_p2.Not())
                    penalties["secondary"].append((1 - has_curator_p2) * (weights.curator_thursday_priority // 3))

        # Slot symmetry between numerator and denominator for multi-pair subjects
        if weights.subject_slot_symmetry:
            seen_sym_streams: set[str] = set()
            for c in curriculums:
                if c.pairs_per_2_weeks < 2 or getattr(c, "require_week", None) is not None:
                    continue
                if c.is_stream and c.stream_id:
                    if c.stream_id in seen_sym_streams:
                        continue
                    seen_sym_streams.add(c.stream_id)
                for d in range(DAYS):
                    for s in range(SLOTS):
                        asym = model.NewBoolVar(f"asym_c{c.id}_d{d}_s{s}")
                        model.Add(asym >= X[(c.id, d, s)] - X[(c.id, d + DAYS, s)])
                        model.Add(asym >= X[(c.id, d + DAYS, s)] - X[(c.id, d, s)])
                        penalties["symmetry"].append(asym * weights.subject_slot_symmetry)

        # Shared physical room conflict avoidance across different teachers
        if weights.shared_room_conflict:
            overloaded_rooms = _overloaded_multi_teacher_rooms(curriculums)
            room_curriculums: dict[str, list] = {}
            for c in curriculums:
                for room_norm in _extract_curriculum_rooms(c):
                    if room_norm in overloaded_rooms:
                        continue
                    room_curriculums.setdefault(room_norm, []).append(c)
            for room_idx, (room_norm, r_currs) in enumerate(sorted(room_curriculums.items())):
                distinct_teachers = {c.teacher_id for c in r_currs}
                if len(distinct_teachers) <= 1:
                    continue
                for d in range(DAY_IDXS):
                    for s in range(SLOTS):
                        room_vars = []
                        seen_room_streams: set[str] = set()
                        for c in r_currs:
                            if c.is_stream and c.stream_id:
                                if c.stream_id in seen_room_streams:
                                    continue
                                seen_room_streams.add(c.stream_id)
                            room_vars.append(X[(c.id, d, s)])
                        if len(room_vars) > 1:
                            room_ov = model.NewIntVar(
                                0, len(room_vars) - 1, f"room_ov_{room_idx}_d{d}_s{s}"
                            )
                            model.Add(room_ov >= sum(room_vars) - 1)
                            penalties["secondary"].append(room_ov * weights.shared_room_conflict)
        # Якщо у предмета увімкнено allow_multiple_per_day (або кілька рядків того самого предмета),
        # але загальне навантаження предмета <= 8 пар/2 тижні і це не фіксований блок (12, 1234),
        # штрафуємо появу 2 пар одного предмета в один день і особливо розірвані пари (1-ша і 3-тя).
        for c in curriculums:
            if (
                getattr(c, "allow_multiple_per_day", False)
                and c.pairs_per_2_weeks <= 8
                and not (c.is_fixed and c.strict_lesson and c.strict_lesson > 4)
            ):
                for d in range(DAY_IDXS):
                    day_cnt = sum(X[(c.id, d, s)] for s in range(SLOTS))
                    extra_same_day = model.NewIntVar(0, SLOTS - 1, f"extra_sameday_c{c.id}_d{d}")
                    model.Add(extra_same_day >= day_cnt - 1)
                    penalties["secondary"].append(extra_same_day * 2_500)
                    # Додатковий штраф, якщо пари одного предмета розірвані іншим предметом (напр. 1-ша і 3-тя)
                    for first in range(SLOTS - 2):
                        split_subj = model.NewBoolVar(f"split_subj_c{c.id}_d{d}_{first}")
                        model.Add(
                            split_subj >= X[(c.id, d, first)] + X[(c.id, d, first + 2)] - X[(c.id, d, first + 1)] - 1
                        )
                        penalties["secondary"].append(split_subj * 5_000)

        return penalties

    def result_from(instance: cp_model.CpSolver, status: int, *, optimized: bool) -> SolveResult:
        assignments = [key for key, var in X.items() if instance.Value(var) == 1]
        objective = (
            instance.ObjectiveValue()
            if optimized
            else float(sum(instance.Value(penalty) for penalty in day_pattern_penalties))
        )
        return SolveResult(
            status=instance.StatusName(status),
            objective=objective,
            assignments=assignments,
        )

    started_at = time.monotonic()
    _report_progress(progress_path, "feasibility", 15, message="Пошук допустимого розкладу")

    opt_limit = float(optimization_time_seconds) if explicit_optimization_budget else DEFAULT_OPTIMIZATION_SECONDS
    if max_time_in_seconds >= 180 and opt_limit <= DEFAULT_OPTIMIZATION_SECONDS:
        opt_limit = max(opt_limit, min(180.0, max_time_in_seconds * 0.6))
    feasibility_budget = (
        max(60.0, max_time_in_seconds * FEASIBILITY_TIME_FRACTION)
        if max_time_in_seconds >= 60
        else max_time_in_seconds * FEASIBILITY_TIME_FRACTION
    )
    feasible_result = None
    last_solver = None
    last_status = cp_model.UNKNOWN

    feas_stop_event = threading.Event()

    def feas_monitor():
        while not feas_stop_event.wait(0.4):
            elapsed_feas = time.monotonic() - started_at
            asymp_frac = 1.0 - math.exp(-elapsed_feas / 8.0)
            budget_frac = min(1.0, elapsed_feas / max(1.0, feasibility_budget))
            frac = max(asymp_frac * 0.9, budget_frac)
            pct = min(50, max(15, int(15 + frac * 35)))  # 15% to 50%
            _report_progress(progress_path, "feasibility", pct, message="Пошук допустимого розкладу")

    feas_thread = threading.Thread(target=feas_monitor, daemon=True)
    feas_thread.start()

    try:
        for attempt in range(FEASIBILITY_RESTARTS):
            if attempt == 0:
                # First attempt uses hints if provided, but caps budget so hints cannot consume
                # the entire generation time if they lead to an intractable search subtree.
                attempt_budget = (
                    min(25.0, feasibility_budget * FIRST_ATTEMPT_TIME_FRACTION)
                    if max_time_in_seconds >= 60
                    else feasibility_budget * FIRST_ATTEMPT_TIME_FRACTION
                )
            else:
                # If first attempt timed out with hints, CLEAR HINTS to search clean without
                # being bogged down by previous-draft assignments. A clean solve finds feasibility in ~3s.
                model.ClearHints()
                attempt_budget = (
                    max(15.0, feasibility_budget - (time.monotonic() - started_at))
                    if max_time_in_seconds >= 60
                    else feasibility_budget * (1 - FIRST_ATTEMPT_TIME_FRACTION)
                )
            feasibility_solver = new_solver(
                attempt_budget,
                (seed or 0) + attempt if seed is not None else attempt,
            )
            feasibility_solver.parameters.stop_after_first_solution = True
            feasibility_solver.parameters.randomize_search = True
            status = feasibility_solver.Solve(model)
            last_solver, last_status = feasibility_solver, status
            if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                feasible_result = result_from(feasibility_solver, status, optimized=False)
                break
            if status != cp_model.UNKNOWN:
                _report_progress(progress_path, "failed", 100, message=f"Статус: {feasibility_solver.StatusName(status)}")
                return SolveResult(
                    status=feasibility_solver.StatusName(status),
                    diagnostics=["Жорсткі обмеження не дозволяють побудувати допустимий розклад."],
                )
    finally:
        feas_stop_event.set()
        feas_thread.join(timeout=1.0)

    if feasible_result is not None:
        _report_progress(progress_path, "feasibility", 55, message="Базовий розклад знайдено")
        remaining = max_time_in_seconds - (time.monotonic() - started_at)
        opt_budget = min(remaining, opt_limit)
        if opt_budget > 0.05:
            penalties = add_soft_preference_penalties()
            phases = [
                ("teacher", "Оптимізація компактності викладачів"),
                ("symmetry", "Оптимізація симетрії тижнів"),
                ("group", "Оптимізація стартів і балансу груп"),
                ("secondary", "Фінальна оптимізація побажань і кабінетів"),
            ]
            active_phases = [(name, message, penalties[name]) for name, message in phases if penalties[name]]
            if active_phases:
                _report_progress(progress_path, "optimizing", 55, message="Багатофазна оптимізація якості...")
                opt_started = time.monotonic()
                total_solutions = 0
                best_result = feasible_result
                phase_shares = {
                    "teacher": 0.50,
                    "symmetry": 0.25,
                    "group": 0.15,
                    "secondary": 0.10,
                }
                share_total = sum(phase_shares[name] for name, _, _ in active_phases)

                for phase_index, (phase_name, phase_message, phase_terms) in enumerate(active_phases):
                    remaining_opt = opt_budget - (time.monotonic() - opt_started)
                    if remaining_opt <= 0.05:
                        break
                    phase_budget = min(
                        remaining_opt,
                        opt_budget * phase_shares[phase_name] / share_total,
                    )
                    phase_started = time.monotonic()
                    phase_expr = sum(phase_terms)
                    model.Minimize(phase_expr)
                    phase_best_value: int | None = None
                    phase_best_assignments: list[tuple[int, int, int]] | None = None
                    restart_count = 2 if phase_budget >= 30.0 else 1
                    restart_budget = phase_budget / restart_count

                    for restart in range(restart_count):
                        remaining_phase = phase_budget - (time.monotonic() - phase_started)
                        if remaining_phase <= 0.05:
                            break
                        selected = set(best_result.assignments)
                        model.ClearHints()
                        if restart == 0:
                            for key, var in X.items():
                                model.AddHint(var, int(key in selected))
                        optimizer = new_solver(
                            min(restart_budget, remaining_phase),
                            None if seed is None else seed + phase_index * 10 + restart + 1,
                        )
                        optimizer.parameters.num_search_workers = max(min(6, num_workers), actual_workers)
                        optimizer.parameters.randomize_search = True
                        status = optimizer.Solve(model)
                        total_solutions += 1
                        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                            continue
                        value = sum(optimizer.Value(term) for term in phase_terms)
                        if phase_best_value is None or value < phase_best_value:
                            phase_best_value = value
                            phase_best_assignments = [
                                key for key, var in X.items() if optimizer.Value(var) == 1
                            ]

                    if phase_best_value is None or phase_best_assignments is None:
                        # Preserve the last known feasible schedule when a
                        # bounded optimization phase times out before finding
                        # a candidate. Later phases cannot safely proceed
                        # without a solution from this phase.
                        break
                    # Preserve teacher compactness exactly. Symmetry is
                    # deliberately bounded rather than absolute: forcing
                    # every weekly subject into the same slot can create
                    # unusable teacher timetables with many windows.
                    phase_tolerance = (
                        max(
                            0,
                            math.ceil(
                                len(phase_terms)
                                * weights.subject_slot_symmetry
                                * 0.15
                            ),
                        )
                        if phase_name == "symmetry" and len(phase_terms) >= 100
                        else 0
                    )
                    model.Add(phase_expr <= phase_best_value + phase_tolerance)
                    best_result = SolveResult(
                        status="FEASIBLE",
                        objective=float(phase_best_value),
                        assignments=phase_best_assignments,
                    )
                    _report_progress(
                        progress_path,
                        "optimizing",
                        min(92, 55 + int(37 * (phase_index + 1) / len(active_phases))),
                        solutions_found=total_solutions,
                        message=f"{phase_message}: {phase_best_value}",
                    )

                _report_progress(
                    progress_path,
                    "saving",
                    95,
                    solutions_found=total_solutions,
                    message="Збереження результату",
                )
                if best_result is not None:
                    return best_result
        return feasible_result

    # CP-SAT UNKNOWN means the bounded search neither found a schedule nor
    # proved infeasibility. Keep that distinction explicit in the API result.
    name = last_solver.StatusName(last_status)
    if last_status == cp_model.UNKNOWN:
        name = "TIMEOUT"
    _report_progress(progress_path, "failed", 100, message=f"Завершено зі статусом {name}")
    return SolveResult(
        status=name,
        diagnostics=(
            ["Пошук завершився без допустимого розкладу в заданій моделі."]
            if name == "INFEASIBLE"
            else []
        ),
    )


def evaluate_quality(
    curriculums: Iterable,
    constraints: Iterable = (),
    assignments: Iterable[tuple[int, int, int]] = (),
    teacher_names: dict[int, str] | None = None,
) -> dict:
    """Обчислює діагностичну оцінку якості згенерованого розкладу."""
    curr_list = list(curriculums)
    cons_list = list(constraints)
    assign_set = set(assignments)
    by_id = {c.id: c for c in curr_list}
    t_names = dict(teacher_names or {})

    for c in curr_list:
        t_obj = getattr(c, "teacher", None)
        if t_obj is not None and getattr(t_obj, "name", None):
            t_names.setdefault(c.teacher_id, t_obj.name)
        t2_obj = getattr(c, "second_teacher", None)
        if c.second_teacher_id and t2_obj is not None and getattr(t2_obj, "name", None):
            t_names.setdefault(c.second_teacher_id, t2_obj.name)

    # 1. Symmetry between numerator and denominator
    # Оцінюємо відносно максимально можливої кількості парних («Щотижня») занять предмета (pairs // 2),
    # щоб предмети з непарною кількістю годин (напр. 3 або 5 пар/2 тижні) не занижували відсоток.
    symmetric_slots = 0
    total_paired_candidates = 0
    if assign_set:
        for c in curr_list:
            if c.pairs_per_2_weeks >= 2 and getattr(c, "require_week", None) is None:
                max_sym = c.pairs_per_2_weeks // 2
                actual_sym = sum(
                    1
                    for d in range(DAYS)
                    for s in range(SLOTS)
                    if (c.id, d, s) in assign_set and (c.id, d + DAYS, s) in assign_set
                )
                total_paired_candidates += max_sym
                symmetric_slots += min(max_sym, actual_sym)
    symmetry_percent = (
        round((symmetric_slots / total_paired_candidates) * 100)
        if total_paired_candidates > 0
        else 100
    )

    # 2. Group day starts (1st pair vs 2nd pair)
    group_names: dict[int, str] = {}
    group_day_slots: dict[tuple[int, int], list[int]] = {}
    for c in curr_list:
        g_obj = getattr(c, "group", None)
        if g_obj is not None and getattr(g_obj, "name", None):
            group_names[c.group_id] = g_obj.name
    for cid, d, s in assign_set:
        c = by_id.get(cid)
        if c is None:
            continue
        group_day_slots.setdefault((c.group_id, d), []).append(s)

    total_group_days = 0
    first_lesson_starts = 0
    late_starts: list[dict] = []
    for (g_id, d), s_list in sorted(group_day_slots.items()):
        if not s_list:
            continue
        total_group_days += 1
        first_s = min(s_list)
        if first_s == 0:
            first_lesson_starts += 1
        else:
            late_starts.append({
                "group_id": g_id,
                "group_name": group_names.get(g_id, f"Група #{g_id}"),
                "day_of_week": (d % DAYS) + 1,
                "week_type": "numerator" if d < DAYS else "denominator",
                "start_lesson": first_s + 1,
            })
    first_lesson_start_percent = (
        round((first_lesson_starts / total_group_days) * 100)
        if total_group_days > 0
        else 100
    )

    # 3. Teacher windows & methodical days
    teacher_day_slots: dict[tuple[int, int], set[int]] = {}
    all_teacher_ids: set[int] = set()
    for c in curr_list:
        if c.teacher_id:
            all_teacher_ids.add(c.teacher_id)
        if c.second_teacher_id:
            all_teacher_ids.add(c.second_teacher_id)
    for cid, d, s in assign_set:
        c = by_id.get(cid)
        if c is None:
            continue
        if _is_curator_hour(c):
            continue
        if c.teacher_id:
            teacher_day_slots.setdefault((c.teacher_id, d), set()).add(s)
        if c.second_teacher_id:
            teacher_day_slots.setdefault((c.second_teacher_id, d), set()).add(s)

    teacher_windows: list[dict] = []
    teacher_single_pair_days: list[dict] = []
    methodical_days_count = 0
    for t_id in sorted(all_teacher_ids):
        num_pairs = sum(len(teacher_day_slots.get((t_id, d), set())) for d in range(DAYS))
        den_pairs = sum(len(teacher_day_slots.get((t_id, d), set())) for d in range(DAYS, DAY_IDXS))
        for d in range(DAY_IDXS):
            occupied = sorted(teacher_day_slots.get((t_id, d), set()))
            if not occupied:
                methodical_days_count += 1
                continue
            week_load = num_pairs if d < DAYS else den_pairs
            if len(occupied) == 1 and week_load >= 2:
                teacher_single_pair_days.append({
                    "teacher_id": t_id,
                    "teacher_name": t_names.get(t_id, f"Викладач #{t_id}"),
                    "day_of_week": (d % DAYS) + 1,
                    "week_type": "numerator" if d < DAYS else "denominator",
                    "lesson_number": occupied[0] + 1,
                })
            if len(occupied) >= 2:
                first_s, last_s = occupied[0], occupied[-1]
                empty = [s + 1 for s in range(first_s, last_s + 1) if s not in occupied]
                if empty:
                    teacher_windows.append({
                        "teacher_id": t_id,
                        "teacher_name": t_names.get(t_id, f"Викладач #{t_id}"),
                        "day_of_week": (d % DAYS) + 1,
                        "week_type": "numerator" if d < DAYS else "denominator",
                        "empty_lessons": empty,
                        "is_double": len(empty) >= 2,
                    })

    # 4. Soft constraint violations
    soft_slots: set[tuple[int, int, int]] = set()
    for con in cons_list:
        if getattr(con, "is_hard_constraint", True):
            continue
        dow_idx = con.day_of_week - 1
        if not 0 <= dow_idx < DAYS:
            continue
        for s_idx in constraint_slot_indices(con):
            soft_slots.add((con.teacher_id, dow_idx, s_idx))
            soft_slots.add((con.teacher_id, dow_idx + DAYS, s_idx))

    soft_violations: list[dict] = []
    for cid, d, s in sorted(assign_set):
        c = by_id.get(cid)
        if c is None:
            continue
        subj_obj = getattr(c, "subject", None)
        subj_name = getattr(subj_obj, "name", None) or f"Предмет #{c.subject_id}"
        for t_id in filter(None, (c.teacher_id, c.second_teacher_id)):
            if (t_id, d, s) in soft_slots:
                soft_violations.append({
                    "teacher_id": t_id,
                    "teacher_name": t_names.get(t_id, f"Викладач #{t_id}"),
                    "group_id": c.group_id,
                    "group_name": group_names.get(c.group_id, f"Група #{c.group_id}"),
                    "subject_name": subj_name,
                    "day_of_week": (d % DAYS) + 1,
                    "week_type": "numerator" if d < DAYS else "denominator",
                    "lesson_number": s + 1,
                })

    # 5. Shared room conflicts
    overloaded_rooms = _overloaded_multi_teacher_rooms(curr_list)
    room_usage: dict[tuple[str, int, int], list[tuple[str, str]]] = {}
    for cid, d, s in sorted(assign_set):
        c = by_id.get(cid)
        if c is None:
            continue
        unit_key = f"stream:{c.stream_id}" if (c.is_stream and c.stream_id) else f"curr:{c.id}"
        g_name = group_names.get(c.group_id, f"Група #{c.group_id}")
        for r_norm in _extract_curriculum_rooms(c):
            if r_norm in overloaded_rooms:
                continue
            entries = room_usage.setdefault((r_norm, d, s), [])
            if not any(u == unit_key for u, _ in entries):
                entries.append((unit_key, g_name))

    room_conflicts: list[dict] = []
    for (r_norm, d, s), entries in sorted(room_usage.items()):
        if len(entries) > 1:
            room_conflicts.append({
                "room": r_norm,
                "day_of_week": (d % DAYS) + 1,
                "week_type": "numerator" if d < DAYS else "denominator",
                "lesson_number": s + 1,
                "groups": [g for _, g in entries],
            })

    total_teacher_active_days = sum(
        1 for occupied in teacher_day_slots.values() if occupied
    )
    window_penalty = sum(2 if item["is_double"] else 1 for item in teacher_windows)
    window_score = max(
        0.0,
        1.0 - window_penalty / max(1, total_teacher_active_days),
    )
    single_day_score = max(
        0.0,
        1.0 - len(teacher_single_pair_days) / max(1, total_teacher_active_days),
    )
    soft_score = max(
        0.0,
        1.0 - len(soft_violations) / max(1, len(assign_set)),
    )
    room_score = max(
        0.0,
        1.0 - len(room_conflicts) / max(1, len(assign_set)),
    )
    quality_score = round(
        100
        * (
            0.30 * (symmetry_percent / 100)
            + 0.20 * (first_lesson_start_percent / 100)
            + 0.20 * window_score
            + 0.15 * single_day_score
            + 0.10 * soft_score
            + 0.05 * room_score
        )
    )

    return {
        "quality_score": quality_score,
        "symmetry_percent": symmetry_percent,
        "first_lesson_start_percent": first_lesson_start_percent,
        "methodical_days_count": methodical_days_count,
        "teacher_windows": teacher_windows,
        "teacher_single_pair_days": teacher_single_pair_days,
        "late_starts": late_starts,
        "soft_constraint_violations": soft_violations,
        "room_conflicts": room_conflicts,
    }
