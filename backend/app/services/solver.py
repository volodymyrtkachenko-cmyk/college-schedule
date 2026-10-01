"""Побудова та розв'язання CP-SAT моделі розкладу (без залежності від БД).

Вхід — будь-які об'єкти з полями Curriculum / TeacherConstraint, тому модуль
легко тестується на синтетичних даних.
"""
from dataclasses import dataclass, field
import time
from typing import Iterable

from ortools.sat.python import cp_model

DAYS = 5                    # Пн..Пт
WEEKS = 2                   # чисельник + знаменник
SLOTS = 4                   # пар на день (1..4)
DAY_IDXS = DAYS * WEEKS     # d = 0..9 (0..4 чисельник, 5..9 знаменник)

MIN_PAIRS_PER_DAY = 3
MAX_PAIRS_PER_DAY = SLOTS

# Дозволені шаблони дня для групи: (пара1, пара2, пара3, пара4) -> штраф.
# ЖОРСТКО заборонено: вихідний (0 пар), 1–2 пари, будь-які «вікна».
# Залишились лише 3 або 4 пари підряд; штрафи задають лише ПЕРЕВАГУ:
#   3 пари з 1-ї — ідеал, 4 пари — трохи гірше, старт з 2-ї пари — запасний варіант.
VALID_PATTERNS = [
    ((1, 1, 1, 0), 0),    # 3 пари з 1-ї — ідеал
    ((1, 1, 1, 1), 5),    # 4 пари
    ((0, 1, 1, 1), 40),   # 3 пари з 2-ї — лише якщо інакше не виходить
]

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
                weekly_min[0] += pairs // 2
                weekly_min[1] += pairs // 2
                weekly_max[0] += (pairs + 1) // 2
                weekly_max[1] += (pairs + 1) // 2
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
    max_time_in_seconds: float = 95,
    num_workers: int = 8,
    patterns=None,
    seed: int | None = None,
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

    for c in curriculums:
        all_vars = [X[(c.id, d, s)] for d in range(DAY_IDXS) for s in range(SLOTS)]
        model.Add(sum(all_vars) == c.pairs_per_2_weeks)

        # Баланс чисельник/знаменник або прив'язка до конкретного тижня
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
            # Жорсткий математичний баланс (як було спочатку), щоб уникнути комбінаторного вибуху та статусу UNKNOWN
            model.Add(w1 >= c.pairs_per_2_weeks // 2)
            model.Add(w1 <= (c.pairs_per_2_weeks + 1) // 2)

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
    penalties = []
    for g_id, curr_list in group_curriculums.items():
        fourth_slots_by_week = [[], []]
        for d in range(DAY_IDXS):
            slots_active = []
            for s in range(SLOTS):
                a = model.NewBoolVar(f"active_g{g_id}_d{d}_s{s}")
                # У групи <= 1 пара в слоті, тож сума і є 0/1 (лінійно — сильніше, ніж MaxEquality)
                model.Add(sum(X[(c.id, d, s)] for c in curr_list) == a)
                slots_active.append(a)
            fourth_slots_by_week[d // DAYS].append(slots_active[SLOTS - 1])

            if use_default_patterns:
                # The three allowed patterns are equivalent to slots 2 and 3
                # always being occupied and at least one of slots 1 and 4
                # being occupied. This avoids three pattern-selector Booleans
                # per group-day while preserving the exact same day layouts.
                model.Add(slots_active[1] == 1)
                model.Add(slots_active[2] == 1)
                model.Add(slots_active[0] + slots_active[3] >= 1)
                penalties.append((1 - slots_active[0]) * 40)
                penalties.append(slots_active[3] * 5)
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

        # Each weekday has exactly 3 or 4 lessons, so each week's number of
        # fourth-period days is determined by its actual weekly load. Linking
        # these directly strengthens propagation for the solver.
        for week in range(WEEKS):
            weekly_load = sum(
                X[(c.id, d, s)]
                for c in curr_list
                for d in range(week * DAYS, (week + 1) * DAYS)
                for s in range(SLOTS)
            )
            model.Add(
                sum(fourth_slots_by_week[week])
                == weekly_load - MIN_PAIRS_PER_DAY * DAYS
            )

    import os
    cpus = os.cpu_count() or 1
    # Завжди беремо мінімум 2 потоки, щоб активувати Portfolio Search (різні евристики одночасно),
    # що критично важливо для складних тетріс-розкладів.
    actual_workers = max(2, min(num_workers, cpus))

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
    feasibility_solver = new_solver(max_time_in_seconds * 0.7, seed)
    feasibility_solver.parameters.stop_after_first_solution = True
    status = feasibility_solver.Solve(model)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        feasible_result = result_from(feasibility_solver, status, optimized=False)
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

    if status != cp_model.UNKNOWN:
        return SolveResult(status=feasibility_solver.StatusName(status))

    # A different seed gets the unused part of the budget when the first
    # feasibility search has not found an incumbent.
    remaining = max_time_in_seconds - (time.monotonic() - started_at)
    if remaining > 0.05:
        retry = new_solver(remaining, (seed or 0) + 1)
        retry.parameters.stop_after_first_solution = True
        retry_status = retry.Solve(model)
        if retry_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return result_from(retry, retry_status, optimized=False)
        status = retry_status
        feasibility_solver = retry

    # CP-SAT UNKNOWN means the bounded search neither found a schedule nor
    # proved infeasibility. Keep that distinction explicit in the API result.
    name = feasibility_solver.StatusName(status)
    if status == cp_model.UNKNOWN:
        name = "TIMEOUT"
    return SolveResult(status=name)
