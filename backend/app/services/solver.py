"""Побудова та розв'язання CP-SAT моделі розкладу (без залежності від БД).

Вхід — будь-які об'єкти з полями Curriculum / TeacherConstraint, тому модуль
легко тестується на синтетичних даних.
"""
from dataclasses import dataclass, field
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
    """Індекси днів (0..9), де в групи закріплена 4-та пара (виховна година).

    Діє лише в тому тижні, де закріплена пара реально стоїть:
    pairs_per_2_weeks == 1 -> тільки чисельник; >= 2 -> обидва тижні.
    """
    days: set[int] = set()
    for c in curr_list:
        if c.is_fixed and c.strict_day and c.strict_lesson == SLOTS:
            days.add(c.strict_day - 1)
            if c.pairs_per_2_weeks >= 2:
                days.add(c.strict_day - 1 + DAYS)
    return set(days)


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
        n_fixed4 = len(fixed_4th_days(lst))
        lo = MIN_PAIRS_PER_DAY * DAY_IDXS + n_fixed4   # день з виховною = рівно 4 пари
        hi = MAX_PAIRS_PER_DAY * DAY_IDXS
        if total < lo:
            extra = f" (з них {n_fixed4} дн. з виховною годиною потребують 4 пар)" if n_fixed4 else ""
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

    # Викладачі: пари потоку рахуємо один раз
    blocked: dict[int, set[tuple[int, int]]] = {}
    for k in constraints:
        blocked.setdefault(k.teacher_id, set()).add((k.day_of_week, k.lesson_number))
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
    patterns = VALID_PATTERNS if patterns is None else patterns

    # (teacher_id, day_idx, slot_idx) недоступності. Обмеження діє в обидва тижні.
    invalid_teacher_slots: set[tuple[int, int, int]] = set()
    for c in constraints:
        dow_idx = c.day_of_week - 1
        slot_idx = c.lesson_number - 1
        invalid_teacher_slots.add((c.teacher_id, dow_idx, slot_idx))
        invalid_teacher_slots.add((c.teacher_id, dow_idx + DAYS, slot_idx))

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

        # Баланс чисельник/знаменник
        w1 = sum(X[(c.id, d, s)] for d in range(DAYS) for s in range(SLOTS))
        model.Add(w1 >= c.pairs_per_2_weeks // 2)
        model.Add(w1 <= (c.pairs_per_2_weeks + 1) // 2)

        # Закріплені пари
        if c.is_fixed and c.strict_day and c.strict_lesson:
            dow_idx, slot_idx = c.strict_day - 1, c.strict_lesson - 1
            if c.pairs_per_2_weeks == 1:
                model.Add(X[(c.id, dow_idx, slot_idx)] == 1)
            elif c.pairs_per_2_weeks >= 2:
                model.Add(X[(c.id, dow_idx, slot_idx)] == 1)
                model.Add(X[(c.id, dow_idx + DAYS, slot_idx)] == 1)

        # Не більше 1 такої самої пари на день
        for d in range(DAY_IDXS):
            model.Add(sum(X[(c.id, d, s)] for s in range(SLOTS)) <= 1)

        # Недоступність викладачів
        for d in range(DAY_IDXS):
            for s in range(SLOTS):
                if (c.teacher_id, d, s) in invalid_teacher_slots:
                    model.Add(X[(c.id, d, s)] == 0)
                if c.second_teacher_id and (c.second_teacher_id, d, s) in invalid_teacher_slots:
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
        for d in range(DAY_IDXS):
            slots_active = []
            for s in range(SLOTS):
                a = model.NewBoolVar(f"active_g{g_id}_d{d}_s{s}")
                # У групи <= 1 пара в слоті, тож сума і є 0/1 (лінійно — сильніше, ніж MaxEquality)
                model.Add(sum(X[(c.id, d, s)] for c in curr_list) == a)
                slots_active.append(a)

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

    if penalties:
        model.Minimize(sum(penalties))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time_in_seconds
    solver.parameters.num_search_workers = num_workers
    if seed is not None:
        solver.parameters.random_seed = seed

    status = solver.Solve(model)
    name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveResult(status=name)

    return SolveResult(
        status=name,
        objective=solver.ObjectiveValue() if penalties else 0.0,
        assignments=[k for k, v in X.items() if solver.Value(v) == 1],
    )
