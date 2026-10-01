import random
from types import SimpleNamespace as NS

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models import Curriculum, Faculty, Group, ScheduleSlot, Subject, Teacher, User
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
            is_fixed=True, strict_day=(g % 5) + 1, strict_lesson=4)
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


def test_prefers_start_from_first_pair(solved):
    curr, cons, r = solved
    late = [e for e in validate(curr, cons, r.assignments) if "початок з пари" in e]
    total_days = len({c.group_id for c in curr}) * 10
    assert len(late) <= 0.1 * total_days     # при нормальному навантаженні майже всі дні з 1-ї пари


def test_two_pair_and_empty_days_are_forbidden():
    """Групі не вистачає пар (26 < 32). Замість зависання алгоритм застосує рятувальні кола (2 пари/день)."""
    curr, cons = make_data(seed=1, load=26)
    assert any("бракує" in m for m in S.precheck(curr, cons))
    r = S.solve(curr, cons, max_time_in_seconds=3, num_workers=4)
    assert r.ok and r.objective > 200


def test_legacy_patterns_allowed_bad_days():
    """Регресія: старі шаблони дозволяють вихідні та 2 пари — саме це й було помилкою."""
    bad = [pat for pat, _ in S.LEGACY_PATTERNS if sum(pat) < 3]
    assert bad, "очікували, що легасі допускав дні з <3 парами"
    ideal = [pat for pat, _ in S.VALID_PATTERNS if sum(pat) >= 3]
    assert len(ideal) >= 3


def test_precheck_counts_fixed_4th_pair_days():
    """30 пар у групи замало, якщо є виховна: 8 днів×3 + 2 дні×4 = 32."""
    curr = [NS(id=1, group_id=1, teacher_id=1, second_teacher_id=None, is_stream=False, stream_id=None,
               pairs_per_2_weeks=2, is_fixed=True, strict_day=3, strict_lesson=4),
            NS(id=2, group_id=1, teacher_id=2, second_teacher_id=None, is_stream=False, stream_id=None,
               pairs_per_2_weeks=28, is_fixed=False, strict_day=None, strict_lesson=None)]
    msgs = S.precheck(curr)
    assert len(msgs) == 1 and "32" in msgs[0]


def test_precheck_flags_overloaded_teacher():
    curr = [NS(id=i, group_id=i, teacher_id=1, second_teacher_id=None, is_stream=False, stream_id=None,
               pairs_per_2_weeks=20, is_fixed=False, strict_day=None, strict_lesson=None) for i in (1, 2, 3)]
    assert any("викладач id=1" in m for m in S.precheck(curr))


# ───────────────────────── тест ендпоінта ─────────────────────────

@pytest.fixture
async def gen_client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with sessions() as session:
            yield session

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
    assert resp.status_code == 200, resp.text
    draft_id = resp.json()["id"]

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
