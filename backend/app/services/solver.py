"""Побудова та розв'язання CP-SAT моделі розкладу (без залежності від БД).

Вхід — будь-які об'єкти з полями Curriculum / TeacherConstraint, тому модуль
легко тестується на синтетичних даних.
"""
from dataclasses import dataclass, field
import json
import math
import os
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
DEFAULT_NUM_WORKERS = 8
DEFAULT_SOLVE_TIME_SECONDS = 600
FEASIBILITY_TIME_FRACTION = 0.9
FEASIBILITY_RESTARTS = 2
FIRST_ATTEMPT_TIME_FRACTION = 0.8


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
) -> set[tuple[int, int, int]]:
    """Read optional ``schedule.json`` hints without making them a dependency."""
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
        by_id = {c.id: c for c in curriculums}
        for c in curriculums:
            by_key.setdefault((c.group_id, c.teacher_id, c.subject_id), []).append(c.id)
        result = set()
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
    return set()

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


def precheck(curriculums: Iterable, constraints: Iterable = ()) -> list[str]:
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
        # Every group studies each weekday; fixed fourth-period lessons consume
        # an additional slot because that day must contain four lessons.
        lo = MIN_PAIRS_PER_DAY * DAY_IDXS + n_fixed4
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
            required = MIN_PAIRS_PER_DAY * DAYS + sum(
                day // DAYS == week for day in fixed4_days
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
        blocked.setdefault(k.teacher_id, set()).add((k.day_of_week, k.lesson_number))
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
            problems.append(
                f"викладач id={t}: {n} пар/2 тижні, але вільних слотів лише {free} — перевантаження на {n - free}"
            )
    return problems


def solve(
    curriculums: list,
    constraints: list,
    max_time_in_seconds: float = DEFAULT_SOLVE_TIME_SECONDS,
    num_workers: int = DEFAULT_NUM_WORKERS,
    patterns=None,
    seed: int | None = None,
    hint_path: str | os.PathLike[str] | None = None,
) -> SolveResult:
    use_default_patterns = patterns is None
    patterns = VALID_PATTERNS if patterns is None else patterns

    # Avoid spending the entire search limit proving simple load contradictions.
    if patterns is VALID_PATTERNS:
        problems = precheck(curriculums, constraints)
        if problems:
            return SolveResult(status="INFEASIBLE")

    # (teacher_id, day_idx, slot_idx) недоступності. Обмеження діє в обидва тижні.
    invalid_teacher_slots: set[tuple[int, int, int]] = set()
    for c in constraints:
        if not getattr(c, "is_hard_constraint", True):
            continue
        dow_idx = c.day_of_week - 1
        slot_idx = c.lesson_number - 1
        invalid_teacher_slots.add((c.teacher_id, dow_idx, slot_idx))
        invalid_teacher_slots.add((c.teacher_id, dow_idx + DAYS, slot_idx))

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

    model = cp_model.CpModel()
    X = {
        (c.id, d, s): model.NewBoolVar(f"X_{c.id}_{d}_{s}")
        for c in curriculums for d in range(DAY_IDXS) for s in range(SLOTS)
    }

    group_curriculums: dict[int, list] = {}
    teacher_curriculums: dict[int, list] = {}
    streams: dict[str, list] = {}
    for c in curriculums:
        group_curriculums.setdefault(c.group_id, []).append(c)
        teacher_curriculums.setdefault(c.teacher_id, []).append(c)
        if c.second_teacher_id:
            teacher_curriculums.setdefault(c.second_teacher_id, []).append(c)
        if c.is_stream and c.stream_id:
            streams.setdefault(c.stream_id, []).append(c)

    week_imbalance_vars = []
    for c in curriculums:
        all_vars = [X[(c.id, d, s)] for d in range(DAY_IDXS) for s in range(SLOTS)]
        model.Add(sum(all_vars) == c.pairs_per_2_weeks)

        # Explicit week pins are hard; otherwise prefer per-subject balance
        # softly while group-level weekly totals remain exactly equal below.
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
            week_imbalance_vars.append(week_imbalance)

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

    group_week_imbalance_vars = []
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
        group_week_imbalance_vars.append(week_imbalance)

    for d in range(DAY_IDXS):
        for s in range(SLOTS):
            for curr_list in group_curriculums.values():
                model.AddAtMostOne([X[(c.id, d, s)] for c in curr_list])

            for curr_list in teacher_curriculums.values():
                unique_vars, seen_streams = [], set()
                for c in curr_list:
                    if c.is_stream and c.stream_id:
                        if c.stream_id in seen_streams:
                            continue
                        seen_streams.add(c.stream_id)
                    unique_vars.append(X[(c.id, d, s)])
                model.AddAtMostOne(unique_vars)

            for curr_list in streams.values():
                if len(curr_list) > 1:
                    base = curr_list[0]
                    for other in curr_list[1:]:
                        model.Add(X[(base.id, d, s)] == X[(other.id, d, s)])

    fixed4 = {g: fixed_4th_days(lst) for g, lst in group_curriculums.items()}
    penalties = (
        [week_imbalance * 1000 for week_imbalance in group_week_imbalance_vars]
        + [week_imbalance * 10 for week_imbalance in week_imbalance_vars]
    )
    for g_id, curr_list in group_curriculums.items():
        for d in range(DAY_IDXS):
            slots_active = []
            for s in range(SLOTS):
                a = model.NewBoolVar(f"active_g{g_id}_d{d}_s{s}")
                model.Add(sum(X[(c.id, d, s)] for c in curr_list) == a)
                slots_active.append(a)

            if use_default_patterns:
                daily_pairs = model.NewIntVar(0, SLOTS, f"daily_pairs_g{g_id}_d{d}")
                model.Add(daily_pairs == sum(slots_active))
                model.AddForbiddenAssignments([daily_pairs], [(0,), (1,), (2,)])

                # If two occupied slots surround a slot, the middle one must
                # be occupied.  Reifying the antecedent avoids enumerating
                # day-pattern combinations.
                for first in range(SLOTS - 2):
                    model.AddImplication(
                        slots_active[first], slots_active[first + 1]
                    ).OnlyEnforceIf(slots_active[first + 2])

                day_active = model.NewBoolVar(f"active_day_g{g_id}_d{d}")
                model.AddMaxEquality(day_active, slots_active)
                late_start = model.NewBoolVar(f"late_start_g{g_id}_d{d}")
                model.Add(late_start <= day_active)
                model.Add(late_start <= 1 - slots_active[0])
                model.Add(late_start >= day_active - slots_active[0])
                penalties.append(late_start * 50)
            else:
                pattern_vars = []
                for p_idx, (pat, pen) in enumerate(patterns):
                    p = model.NewBoolVar(f"pat_{g_id}_{d}_{p_idx}")
                    pattern_vars.append(p)
                    if pen:
                        penalties.append(p * pen)
                    for s in range(SLOTS):
                        model.Add(slots_active[s] == pat[s]).OnlyEnforceIf(p)
                model.AddExactlyOne(pattern_vars)

            # Виховна година (закріплена 4-та пара) => у цей день рівно 4 пари.
            if d in fixed4[g_id]:
                model.Add(slots_active[0] == 1)

    # Teacher gaps are preferences, not hard constraints. Stream copies are
    # counted once because they use one teacher slot.
    for teacher_id, curr_list in teacher_curriculums.items():
        for d in range(DAY_IDXS):
            active = []
            for s in range(SLOTS):
                unique_vars = []
                seen_streams = set()
                for c in curr_list:
                    if c.is_stream and c.stream_id:
                        if c.stream_id in seen_streams:
                            continue
                        seen_streams.add(c.stream_id)
                    unique_vars.append(X[(c.id, d, s)])
                teacher_active = model.NewBoolVar(f"active_t{teacher_id}_d{d}_s{s}")
                model.Add(sum(unique_vars) == teacher_active)
                active.append(teacher_active)
            for first in range(SLOTS - 2):
                window = model.NewBoolVar(f"window_t{teacher_id}_d{d}_{first}")
                model.Add(window <= active[first])
                model.Add(window <= active[first + 2])
                model.Add(window <= 1 - active[first + 1])
                model.Add(
                    window >= active[first] + active[first + 2] - active[first + 1] - 1
                )
                penalties.append(window * 100)

    hint_assignments = _schedule_hint_assignments(curriculums, hint_path)
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

    def result_from(instance: cp_model.CpSolver, status: int, *, optimized: bool) -> SolveResult:
        assignments = [key for key, var in X.items() if instance.Value(var) == 1]
        objective = (
            instance.ObjectiveValue()
            if optimized
            else float(sum(instance.Value(penalty) for penalty in penalties))
        )
        return SolveResult(
            status=instance.StatusName(status),
            objective=objective,
            assignments=assignments,
        )

    started_at = time.monotonic()
    # First find any valid timetable without optimizing soft preferences. Search
    # with an objective can spend most of the limit before producing its first
    # incumbent, which is especially costly on small hosted instances.
    if penalties:
        model.ClearObjective()
    feasibility_budget = max_time_in_seconds * FEASIBILITY_TIME_FRACTION
    feasible_result = None
    last_solver = None
    last_status = cp_model.UNKNOWN
    for attempt in range(FEASIBILITY_RESTARTS):
        if attempt == 0:
            attempt_budget = feasibility_budget * FIRST_ATTEMPT_TIME_FRACTION
        else:
            attempt_budget = feasibility_budget * (1 - FIRST_ATTEMPT_TIME_FRACTION)
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
            return SolveResult(status=feasibility_solver.StatusName(status))

    if feasible_result is not None:
        remaining = max_time_in_seconds - (time.monotonic() - started_at)
        if penalties and remaining > 0.05:
            selected = set(feasible_result.assignments)
            for key, var in X.items():
                model.AddHint(var, int(key in selected))
            model.Minimize(sum(penalties))
            optimizer = new_solver(remaining, None if seed is None else seed + 1)
            optimized_status = optimizer.Solve(model)
            if optimized_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                return result_from(optimizer, optimized_status, optimized=True)
        return feasible_result

    # CP-SAT UNKNOWN means the bounded search neither found a schedule nor
    # proved infeasibility. Keep that distinction explicit in the API result.
    name = last_solver.StatusName(last_status)
    if last_status == cp_model.UNKNOWN:
        name = "TIMEOUT"
    return SolveResult(status=name)
