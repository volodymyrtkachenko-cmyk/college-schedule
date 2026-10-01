import random
from types import SimpleNamespace as NS

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import Curriculum, Faculty, Group, ScheduleSlot, Subject, Teacher, User
from app.schemas.curriculum import CurriculumCreate, CurriculumUpdate
from app.core.security import create_access_token
from app.services import solver as S


# ───────────────────────── допоміжне ─────────────────────────

def make_data(n_groups=6, n_teachers=18, seed=1, load=34):
    """Синтетичне навантаження: виховна година (4-та пара), звичайні предмети, 2 потоки, обмеження викладачів."""
    rnd = random.Random(seed)
    curr, cid = [], 0

    def add(**kw):
        nonlocal cid
        cid += 1
        d = dict(id=cid, second_teacher_id=None, is_stream=False, stream_id=None,
                 strict_day=None, strict_lesson=None, is_fixed=False)
        d.update(kw)
        curr.append(NS(**d))

    tpool = list(range(n_groups + 1, n_teachers + 1))
    for g in range(1, n_groups + 1):
        add(group_id=g, subject_id=99, teacher_id=g, pairs_per_2_weeks=2,
            is_fixed=True, strict_day=(1, 2, 3, 5)[(g - 1) % 4], strict_lesson=4)
        left, sid = load - 2, 1
        while left > 0:
            p = min(left, rnd.choice([2, 2, 4, 4, 6]))
            add(group_id=g, subject_id=sid, teacher_id=rnd.choice(tpool), pairs_per_2_weeks=p)
            left -= p
            sid += 1
    for a, b, t, sid in [(1, 2, tpool[0], 50), (3, 4, tpool[1], 51)]:
        for g in (a, b):
            add(group_id=g, subject_id=sid, teacher_id=t, pairs_per_2_weeks=2,
                is_stream=True, stream_id=f"stream_{sid}")
    cons = [NS(teacher_id=t, day_of_week=rnd.randint(1, 5), lesson_number=rnd.randint(1, 4))
            for t in tpool for _ in range(rnd.choice([0, 2, 4]))]
    return curr, cons


def validate(curr, cons, assignments):
    """Незалежна перевірка ВСІХ жорстких вимог до розкладу. Повертає список порушень."""
    by = {c.id: c for c in curr}
    errs = []
    blocked = {(k.teacher_id, k.day_of_week - 1, k.lesson_number - 1) for k in cons}

    # кількість пар на предмет
    cnt = {}
    for cid, d, s in assignments:
        cnt[cid] = cnt.get(cid, 0) + 1
    for c in curr:
        if cnt.get(c.id, 0) != c.pairs_per_2_weeks:
            errs.append(f"curr {c.id}: {cnt.get(c.id, 0)} пар замість {c.pairs_per_2_weeks}")

    group_day, teacher_slot, stream_slots = {}, {}, {}
    for cid, d, s in assignments:
        c = by[cid]
        group_day.setdefault((c.group_id, d), []).append(s)
        for t in filter(None, (c.teacher_id, c.second_teacher_id)):
            if (t, d % 5, s) in blocked:
                errs.append(f"викладач {t} недоступний d={d} s={s}")
            key = (t, d, s)
            # пари одного потоку — одна пара викладача
            unit = c.stream_id if (c.is_stream and c.stream_id) else f"c{cid}"
            teacher_slot.setdefault(key, set()).add(unit)
        if c.is_stream and c.stream_id:
            stream_slots.setdefault(c.stream_id, {}).setdefault(c.group_id, set()).add((d, s))
        if c.is_fixed and c.strict_lesson and s + 1 == c.strict_lesson and d % 5 + 1 == c.strict_day:
            pass

    for key, units in teacher_slot.items():
        if len(units) > 1:
            errs.append(f"накладка викладача {key}: {units}")
    for sid, per_group in stream_slots.items():
        sets = list(per_group.values())
        if any(x != sets[0] for x in sets):
            errs.append(f"потік {sid} не синхронний")

    for g in sorted({c.group_id for c in curr}):
        for d in range(10):
            slots = sorted(group_day.get((g, d), []))
            if len(slots) != len(set(slots)):
                errs.append(f"група {g} d={d}: дві пари в одному слоті")
            if len(slots) < 3:
                errs.append(f"група {g} d={d}: лише {len(slots)} пар (мінімум 3, вихідних не буває)")
            elif slots != list(range(slots[0], slots[0] + len(slots))):
                errs.append(f"група {g} d={d}: вікно {slots}")
            if slots and slots[0] > 1:
                errs.append(f"група {g} d={d}: початок з пари {slots[0] + 1}")

    # закріплені пари + виховна => 4 пари в цей день
    for c in curr:
        if c.is_fixed and c.strict_day and c.strict_lesson:
            weeks = (0, 1) if c.pairs_per_2_weeks >= 2 else (0,)
            for w in weeks:
                d = c.strict_day - 1 + 5 * w
                if (c.id, d, c.strict_lesson - 1) not in set(assignments):
                    errs.append(f"закріплена пара curr {c.id} не на місці d={d}")
                if c.strict_lesson == 4 and len(group_day.get((c.group_id, d), [])) != 4:
                    errs.append(f"група {c.group_id} d={d}: виховна година, але не 4 пари")
    return errs


# ───────────────────────── тести солвера ─────────────────────────

@pytest.fixture(scope="module", params=[1, 2])
def solved(request):
    """Один раз розв'язуємо синтетичне навантаження (дорога операція) і ділимо результат між тестами."""
    curr, cons = make_data(seed=request.param, load=34)
    assert S.precheck(curr, cons) == []
    r = S.solve(curr, cons, max_time_in_seconds=8, num_workers=4)
    assert r.ok, r.status
    return curr, cons, r


def test_every_weekday_has_3_or_4_pairs_no_windows(solved):
    curr, cons, r = solved
    errs = [e for e in validate(curr, cons, r.assignments) if "початок з пари" not in e]
    assert errs == []          # усі 10 днів заповнені, >=3 пар, без вікон, без накладок
    by = {c.id: c for c in curr}
    days = {}
    for cid, d, s in r.assignments:
        days.setdefault((by[cid].group_id, d), set()).add(s)
    allowed = {pattern for pattern, _ in S.VALID_PATTERNS}
    assert all(tuple(int(s in days[(g, d)]) for s in range(S.SLOTS)) in allowed
               for g in {c.group_id for c in curr} for d in range(S.DAY_IDXS))
    assert not any(d in (3, 8) and s == 3 for _, d, s in r.assignments)


def test_subjects_are_balanced_between_weeks(solved):
    curr, _, result = solved
    week_counts = {}
    for curriculum_id, day, _slot in result.assignments:
        counts = week_counts.setdefault(curriculum_id, [0, 0])
        counts[int(day >= S.DAYS)] += 1
    for item in curr:
        if getattr(item, "require_week", None) is None:
            assert abs(week_counts.get(item.id, [0, 0])[0] -
                       week_counts.get(item.id, [0, 0])[1]) <= 1


def test_prefers_start_from_first_pair(solved):
    curr, cons, r = solved
    late = [e for e in validate(curr, cons, r.assignments) if "початок з пари" in e]
    total_days = len({c.group_id for c in curr}) * 10
    assert len(late) <= 0.1 * total_days     # при нормальному навантаженні майже всі дні з 1-ї пари


def test_underloaded_group_is_rejected_before_search():
    """A provable daily-load shortage must not enter an expensive CP-SAT search."""
    curr, cons = make_data(seed=1, load=26)
    assert any("бракує" in m for m in S.precheck(curr, cons))
    r = S.solve(curr, cons, max_time_in_seconds=3, num_workers=4)
    assert not r.ok
    assert r.status == "INFEASIBLE"


def test_legacy_patterns_allowed_bad_days():
    """Регресія: старі шаблони дозволяють вихідні та 2 пари — саме це й було помилкою."""
    bad = [pat for pat, _ in S.LEGACY_PATTERNS if sum(pat) < 3]
    assert bad, "очікували, що легасі допускав дні з <3 парами"
    ideal = [pat for pat, _ in S.VALID_PATTERNS if sum(pat) >= 3]
    assert len(ideal) >= 3


def test_precheck_counts_fixed_4th_pair_days():
    """A 31-pair load is short by one when both Thursday curator hours are included."""
    group = NS(name="G1", curator_id=1)
    curr = [NS(id=1, group_id=1, group=group, subject=NS(name="Виховна година"),
               teacher_id=1, second_teacher_id=None, is_stream=False, stream_id=None,
               pairs_per_2_weeks=2, is_fixed=True, strict_day=4, strict_lesson=4,
               require_week=None),
            NS(id=2, group_id=1, teacher_id=2, second_teacher_id=None, is_stream=False, stream_id=None,
               pairs_per_2_weeks=29, is_fixed=False, strict_day=None, strict_lesson=None,
               require_week=None)]
    msgs = S.precheck(curr)
    assert any("32" in message and "бракує 1" in message for message in msgs)


def test_precheck_counts_fixed_external_block_fourth_period_day():
    group = NS(name="G1", curator_id=1)
    curr = [
        NS(id=1, group_id=1, group=group, subject=NS(name="Виховна година"),
           teacher_id=1, second_teacher_id=None, is_stream=False, stream_id=None,
           pairs_per_2_weeks=2, is_fixed=True, strict_day=4, strict_lesson=4,
           require_week=None),
        NS(id=2, group_id=1, group=group, subject=NS(name="Захист України"),
           teacher_id=2, second_teacher_id=None, is_stream=True, stream_id="defense",
           pairs_per_2_weeks=4, is_fixed=True, strict_day=1, strict_lesson=1234,
           require_week="numerator", allow_multiple_per_day=True),
        NS(id=3, group_id=1, group=group, subject=NS(name="Інші предмети"),
           teacher_id=3, second_teacher_id=None, is_stream=False, stream_id=None,
           pairs_per_2_weeks=26, is_fixed=False, strict_day=None, strict_lesson=None,
           require_week=None),
    ]
    msgs = S.precheck(curr)
    assert S.fixed_4th_days(curr) == {0, 3, 8}
    assert any("33" in message and "бракує 1" in message for message in msgs)


def test_thirty_two_pairs_suffice_with_only_two_thursday_curator_hours():
    group = NS(name="G1", curator_id=1)
    curr = [
        NS(id=1, group_id=1, group=group, subject=NS(name="Виховна година"),
           teacher_id=1, second_teacher_id=None, is_stream=False, stream_id=None,
           pairs_per_2_weeks=2, is_fixed=True, strict_day=4, strict_lesson=4,
           require_week=None),
        NS(id=2, group_id=1, teacher_id=2, second_teacher_id=None,
           is_stream=False, stream_id=None, pairs_per_2_weeks=30,
           is_fixed=False, strict_day=None, strict_lesson=None, require_week=None),
    ]
    assert S.fixed_4th_days(curr) == {3, 8}
    assert S.precheck(curr) == []


def test_fixed_non_fourth_slot_does_not_raise_minimum():
    curr = [
        NS(id=1, group_id=1, teacher_id=1, second_teacher_id=None,
           is_stream=False, stream_id=None, pairs_per_2_weeks=2,
           is_fixed=True, strict_day=3, strict_lesson=3, require_week=None),
        NS(id=2, group_id=1, teacher_id=2, second_teacher_id=None,
           is_stream=False, stream_id=None, pairs_per_2_weeks=28,
           is_fixed=False, strict_day=None, strict_lesson=None, require_week=None),
    ]
    assert S.fixed_4th_days(curr) == set()
    assert S.precheck(curr) == []


def test_precheck_flags_overloaded_teacher():
    curr = [NS(id=i, group_id=i, teacher_id=1, second_teacher_id=None, is_stream=False, stream_id=None,
               pairs_per_2_weeks=20, is_fixed=False, strict_day=None, strict_lesson=None) for i in (1, 2, 3)]
    assert any("викладач id=1" in m for m in S.precheck(curr))


def test_unknown_solver_status_is_reported_as_timeout(monkeypatch):
    time_limits = []

    class FakeSolver:
        parameters = NS()
        calls = 0

        def Solve(self, _model):
            type(self).calls += 1
            time_limits.append(self.parameters.max_time_in_seconds)
            return S.cp_model.UNKNOWN

        @staticmethod
        def StatusName(_status):
            return "UNKNOWN"

    monkeypatch.setattr(S.cp_model, "CpSolver", FakeSolver)
    monkeypatch.setattr(S, "effective_cpu_count", lambda: 1)
    curr = [NS(id=1, group_id=1, teacher_id=1, second_teacher_id=None,
               is_stream=False, stream_id=None, pairs_per_2_weeks=30,
               is_fixed=False, strict_day=None, strict_lesson=None,
               require_week=None, allow_multiple_per_day=False)]
    result = S.solve(curr, [], max_time_in_seconds=1)
    assert result.status == "TIMEOUT"
    assert not result.ok
    assert FakeSolver.calls == S.FEASIBILITY_RESTARTS
    assert FakeSolver.parameters.num_search_workers == 2
    assert time_limits == pytest.approx([
        S.FEASIBILITY_TIME_FRACTION * S.FIRST_ATTEMPT_TIME_FRACTION,
        S.FEASIBILITY_TIME_FRACTION * (1 - S.FIRST_ATTEMPT_TIME_FRACTION),
    ])


def test_default_generator_search_budget_is_ten_minutes():
    assert S.DEFAULT_SOLVE_TIME_SECONDS == 600


def test_worker_count_respects_container_cpu_quota(monkeypatch):
    monkeypatch.setattr(S.os, "cpu_count", lambda: 8)
    monkeypatch.setattr(S.os, "sched_getaffinity", lambda _pid: set(range(8)), raising=False)
    monkeypatch.setattr(S, "_cgroup_cpu_quota", lambda: 0.5)

    assert S.selected_worker_count(8) == 2


def test_feasible_schedule_is_kept_if_preference_optimization_times_out(monkeypatch):
    real_solver = S.cp_model.CpSolver
    calls = 0

    class TimeoutSolver:
        parameters = NS()

        def Solve(self, _model):
            return S.cp_model.UNKNOWN

        @staticmethod
        def StatusName(_status):
            return "UNKNOWN"

    def solver_factory():
        nonlocal calls
        calls += 1
        return real_solver() if calls == 1 else TimeoutSolver()

    monkeypatch.setattr(S.cp_model, "CpSolver", solver_factory)
    curr = [NS(id=1, group_id=1, teacher_id=1, second_teacher_id=None,
               is_stream=False, stream_id=None, pairs_per_2_weeks=30,
               is_fixed=False, strict_day=None, strict_lesson=None,
               require_week=None, allow_multiple_per_day=True)]

    result = S.solve(curr, [], max_time_in_seconds=5, num_workers=2)

    assert result.ok, result.status
    assert len(result.assignments) == 30
    assert calls == 2


def test_thursday_curator_hour_is_fixed_and_reserved():
    group = NS(name="G1", curator_id=1)
    curr = [
        NS(id=1, group_id=1, group=group, teacher_id=2, second_teacher_id=None,
           is_stream=False, stream_id=None, pairs_per_2_weeks=30,
           is_fixed=False, strict_day=None, strict_lesson=None,
           require_week=None, allow_multiple_per_day=True),
        NS(id=2, group_id=1, group=group, teacher_id=1, second_teacher_id=None,
           subject=NS(name="Виховна година"),
           is_stream=False, stream_id=None, pairs_per_2_weeks=2,
           is_fixed=True, strict_day=4, strict_lesson=4,
           require_week=None, allow_multiple_per_day=False),
    ]
    assert S.precheck(curr) == []
    result = S.solve(curr, [], max_time_in_seconds=5, num_workers=4)
    assert result.ok, result.status
    assert (2, 3, 3) in result.assignments
    assert (2, 8, 3) in result.assignments
    assert not any((curriculum_id, day, slot) in result.assignments
                   for curriculum_id in (1,) for day in (3, 8) for slot in (3,))
    for week_start in (0, S.DAYS):
        four_lesson_days = [
            day for day in range(week_start, week_start + S.DAYS)
            if sum((curriculum_id, day, slot) in result.assignments
                   for curriculum_id in (1, 2) for slot in range(S.SLOTS)) == 4
        ]
        assert four_lesson_days == [week_start + 3]


def test_exact_block_slots_and_required_week_are_enforced():
    curr = [
        NS(id=1, group_id=1, teacher_id=1, second_teacher_id=None,
           is_stream=False, stream_id=None, pairs_per_2_weeks=2,
           is_fixed=True, strict_day=1, strict_lesson=12,
           require_week="numerator", allow_multiple_per_day=True),
        NS(id=2, group_id=1, teacher_id=2, second_teacher_id=None,
           is_stream=False, stream_id=None, pairs_per_2_weeks=30,
           is_fixed=False, strict_day=None, strict_lesson=None,
           require_week=None, allow_multiple_per_day=True),
    ]
    assert S.precheck(curr) == []
    result = S.solve(curr, [], max_time_in_seconds=5, num_workers=4)
    assert result.ok, result.status
    assert {(cid, day, slot) for cid, day, slot in result.assignments if cid == 1} == {
        (1, 0, 0), (1, 0, 1)
    }


def test_curriculum_schema_validates_week_and_exact_block_rules():
    with pytest.raises(ValueError):
        CurriculumCreate(group_id=1, subject_id=1, teacher_id=1, pairs_per_2_weeks=2,
                         require_week="both")
    with pytest.raises(ValueError):
        CurriculumCreate(group_id=1, subject_id=1, teacher_id=1, pairs_per_2_weeks=2,
                         strict_lesson=12, allow_multiple_per_day=False)
    with pytest.raises(ValueError):
        CurriculumCreate(group_id=1, subject_id=1, teacher_id=1, pairs_per_2_weeks=2,
                         strict_lesson=122, allow_multiple_per_day=True)
    # PATCH may update an existing block's slot without resubmitting its flag.
    assert CurriculumUpdate(strict_lesson=12).strict_lesson == 12


# ───────────────────────── тест ендпоінта ─────────────────────────

@pytest.fixture
async def gen_client(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with sessions() as session:
            yield session

    monkeypatch.setattr("app.routers.generator.async_session_factory", sessions)
    app.dependency_overrides[get_db] = override_get_db
    async with sessions() as session:
        admin = User(username="admin", name="admin", role="admin", password_hash="hash")
        fac = Faculty(name="F")
        session.add_all([admin, fac])
        await session.flush()
        token = create_access_token(admin)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, {"Authorization": f"Bearer {token}"}, sessions, fac.id
    app.dependency_overrides.clear()
    await engine.dispose()


async def _seed(sessions, fac_id, group_load):
    """group_load: список (назва, пар/2 тижні) — навантаження розбивається на предмети по 4 пари."""
    async with sessions() as s:
        teachers = [Teacher(name=f"T{i}") for i in range(12)]
        subjects = [Subject(name=f"S{i}") for i in range(12)]
        s.add_all(teachers + subjects)
        await s.flush()
        k = 0
        for gname, total in group_load:
            g = Group(name=gname, faculty_id=fac_id)
            s.add(g)
            await s.flush()
            left, i = total, 0
            while left > 0:
                p = min(4, left)
                s.add(Curriculum(group_id=g.id, subject_id=subjects[i % 12].id,
                                 teacher_id=teachers[k % 12].id, pairs_per_2_weeks=p))
                left -= p; i += 1; k += 1
        await s.commit()


@pytest.mark.anyio
async def test_api_generates_valid_draft(gen_client):
    client, headers, sessions, fac = gen_client
    await _seed(sessions, fac, [("G1", 32), ("G2", 34)])
    resp = await client.post("/api/generator?max_time_in_seconds=20", headers=headers)
    assert resp.status_code == 202, resp.text
    assert resp.json()["status"] == "GENERATING"
    draft_id = resp.json()["id"]
    status_resp = await client.get(f"/api/drafts/{draft_id}", headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "DRAFT"

    async with sessions() as s:
        slots = (await s.scalars(select(ScheduleSlot).where(ScheduleSlot.draft_id == draft_id))).all()
        curr = (await s.scalars(select(Curriculum))).all()
    by = {c.id: c for c in curr}
    days = {}
    for sl in slots:
        d = sl.day_of_week - 1 + (5 if sl.week_type == "denominator" else 0)
        days.setdefault((by[sl.curriculum_id].group_id, d), []).append(sl.lesson_number)
    for g in {c.group_id for c in curr}:
        for d in range(10):
            ln = sorted(days.get((g, d), []))
            assert len(ln) >= 3, f"група {g}, день {d}: {ln}"
            assert ln == list(range(ln[0], ln[0] + len(ln))), f"вікно: {ln}"


@pytest.mark.anyio
async def test_api_explains_underloaded_group(gen_client):
    client, headers, sessions, fac = gen_client
    await _seed(sessions, fac, [("G1", 34), ("Мала", 24)])
    resp = await client.post("/api/generator?max_time_in_seconds=10", headers=headers)
    assert resp.status_code == 400
    assert "бракує" in resp.json()["detail"]


@pytest.mark.anyio
async def test_api_returns_safe_diagnostics_on_solver_timeout(gen_client, monkeypatch):
    client, headers, sessions, fac = gen_client
    await _seed(sessions, fac, [("G1", 32)])
    monkeypatch.setattr(S, "solve", lambda *_args, **_kwargs: S.SolveResult(status="TIMEOUT"))

    resp = await client.post("/api/generator?max_time_in_seconds=1", headers=headers)

    assert resp.status_code == 202
    draft_id = resp.json()["id"]
    status_resp = await client.get(f"/api/drafts/{draft_id}", headers=headers)
    assert status_resp.json()["status"] == "TIMEOUT"
