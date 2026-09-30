from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from ortools.sat.python import cp_model
import asyncio

from app.database import get_db
from app.models import Curriculum, TeacherConstraint, ScheduleDraft, ScheduleSlot
from app.schemas.constraint import ScheduleDraftResponse
from app.core.security import require_roles

router = APIRouter(prefix="/generator", tags=["Generator"])

@router.post("", response_model=ScheduleDraftResponse)
async def generate_schedule(
    max_time_in_seconds: int = 30,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_roles("admin"))
):
    # 1. Fetch data
    curriculums = (await db.scalars(select(Curriculum))).all()
    constraints = (await db.scalars(select(TeacherConstraint))).all()
    
    if not curriculums:
        raise HTTPException(status_code=400, detail="Немає навантаження для генерації.")

    # Convert constraints to a fast lookup set
    # day_of_week is 1..5. We'll map it to day index 0..9 (two weeks)
    invalid_teacher_slots = set() # (teacher_id, day_idx, slot_idx)
    for c in constraints:
        # A constraint applies to both numerator (day 0..4 = dow-1) 
        # and denominator (day 5..9 = dow-1+5)
        dow_idx = c.day_of_week - 1
        slot_idx = c.lesson_number - 1
        invalid_teacher_slots.add((c.teacher_id, dow_idx, slot_idx))
        invalid_teacher_slots.add((c.teacher_id, dow_idx + 5, slot_idx))
    
    # 2. Build model
    model = cp_model.CpModel()
    
    # Variables X[(curr_id, d, s)]
    # d in 0..9, s in 0..3
    X = {}
    for curr in curriculums:
        for d in range(10):
            for s in range(4):
                X[(curr.id, d, s)] = model.NewBoolVar(f"X_{curr.id}_{d}_{s}")
    
    # Pre-group by attributes
    group_curriculums = {}
    teacher_curriculums = {}
    streams = {}
    
    for curr in curriculums:
        group_curriculums.setdefault(curr.group_id, []).append(curr)
        teacher_curriculums.setdefault(curr.teacher_id, []).append(curr)
        if curr.second_teacher_id:
            teacher_curriculums.setdefault(curr.second_teacher_id, []).append(curr)
        
        if curr.is_stream and curr.stream_id:
            streams.setdefault(curr.stream_id, []).append(curr)
            
    # Constraints
    for curr in curriculums:
        # 1. Exactly `pairs_per_2_weeks` assignments
        model.AddExactlyOne([X[(curr.id, d, s)] for d in range(10) for s in range(4)]) if curr.pairs_per_2_weeks == 1 else \
        model.Add(sum(X[(curr.id, d, s)] for d in range(10) for s in range(4)) == curr.pairs_per_2_weeks)
        
        # 2. Fixed slots
        if curr.is_fixed and curr.strict_day and curr.strict_lesson:
            dow_idx = curr.strict_day - 1
            slot_idx = curr.strict_lesson - 1
            if curr.pairs_per_2_weeks == 1:
                # Force on numerator by default for 1 pair/2 weeks
                model.Add(X[(curr.id, dow_idx, slot_idx)] == 1)
            elif curr.pairs_per_2_weeks >= 2:
                # Force on both weeks
                model.Add(X[(curr.id, dow_idx, slot_idx)] == 1)
                model.Add(X[(curr.id, dow_idx + 5, slot_idx)] == 1)

        # 3. Teacher unavailability
        for d in range(10):
            for s in range(4):
                if (curr.teacher_id, d, s) in invalid_teacher_slots:
                    model.Add(X[(curr.id, d, s)] == 0)
                if curr.second_teacher_id and (curr.second_teacher_id, d, s) in invalid_teacher_slots:
                    model.Add(X[(curr.id, d, s)] == 0)
        
    for d in range(10):
        for s in range(4):
            # 4. Group uniqueness (<= 1 pair per slot)
            for g_id, curr_list in group_curriculums.items():
                model.AddAtMostOne([X[(c.id, d, s)] for c in curr_list])
            
            # 5. Teacher uniqueness (<= 1 pair per slot)
            for t_id, curr_list in teacher_curriculums.items():
                unique_vars = []
                seen_streams = set()
                for c in curr_list:
                    if c.is_stream and c.stream_id:
                        if c.stream_id not in seen_streams:
                            seen_streams.add(c.stream_id)
                            unique_vars.append(X[(c.id, d, s)])
                    else:
                        unique_vars.append(X[(c.id, d, s)])
                model.AddAtMostOne(unique_vars)
                
            # 6. Stream synchronization
            for stream_id, curr_list in streams.items():
                if len(curr_list) > 1:
                    base_c = curr_list[0]
                    for other_c in curr_list[1:]:
                        model.Add(X[(base_c.id, d, s)] == X[(other_c.id, d, s)])

    # Soft constraints (Penalties)
    penalties = []
    
    for g_id, curr_list in group_curriculums.items():
        for d in range(10):
            # Window check: pair on slot 0, nothing on 1, pair on 2 -> penalty
            # Simplest representation: sum(slot 0 + slot 2) - slot 1 <= 1 (if > 1, means window)
            # A more robust boolean indicator: 
            # W1 = (s0 and not s1 and s2)
            # Let slots in this day for this group be sum per slot over all subjects
            slots_active = []
            for s in range(4):
                slot_active = model.NewBoolVar(f"active_g{g_id}_d{d}_s{s}")
                # slot_active is 1 if any curriculum has a pair in this slot
                model.AddMaxEquality(slot_active, [X[(c.id, d, s)] for c in curr_list])
                slots_active.append(slot_active)
            
            # Window 1: pairs at 0 and 2, but not 1
            w1 = model.NewBoolVar(f"w1_g{g_id}_d{d}")
            model.Add(w1 >= slots_active[0] + slots_active[2] - slots_active[1] - 1)
            penalties.append(w1 * 50)
            
            # Window 2: pairs at 1 and 3, but not 2
            w2 = model.NewBoolVar(f"w2_g{g_id}_d{d}")
            model.Add(w2 >= slots_active[1] + slots_active[3] - slots_active[2] - 1)
            penalties.append(w2 * 50)
            
            # Big Window: pairs at 0 and 3, but not 1 AND not 2
            w3 = model.NewBoolVar(f"w3_g{g_id}_d{d}")
            model.Add(w3 >= slots_active[0] + slots_active[3] - slots_active[1] - slots_active[2] - 1)
            penalties.append(w3 * 80)
                
            # Load balance: >3 pairs a day is bad
            # Let pairs_in_day = sum(X[(c.id, d, s)])
            # penalty >= pairs_in_day - 3
            pairs_in_day = sum([X[(c.id, d, s)] for c in curr_list for s in range(4)])
            excess = model.NewIntVar(0, 4, f"excess_g{g_id}_d{d}")
            model.Add(excess >= pairs_in_day - 3)
            penalties.append(excess * 10)
            
    if penalties:
        model.Minimize(sum(penalties))

    # 3. Solve asynchronously
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time_in_seconds
    
    # We run the solver in a thread so we don't block the asyncio event loop
    status_code = await asyncio.to_thread(solver.Solve, model)
    
    if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Create Draft
        draft_name = f"Генерація від {datetime.now().strftime('%d.%m %H:%M')}"
        draft = ScheduleDraft(name=draft_name, status="DRAFT")
        db.add(draft)
        await db.flush() # get draft.id
        
        # Save slots
        slots_to_insert = []
        for (c_id, d, s), var in X.items():
            if solver.Value(var) == 1:
                week_type = "numerator" if d < 5 else "denominator"
                dow = (d % 5) + 1
                slot_num = s + 1
                
                # Fetch curriculum to replicate data
                c = next(x for x in curriculums if x.id == c_id)
                slots_to_insert.append(
                    ScheduleSlot(
                        draft_id=draft.id,
                        curriculum_id=c.id,
                        day_of_week=dow,
                        lesson_number=slot_num,
                        week_type=week_type
                    )
                )
        db.add_all(slots_to_insert)
        await db.commit()
        return draft
    
    else:
        raise HTTPException(status_code=400, detail="Неможливо скласти розклад. Математичний конфлікт (перевірте обмеження та перевантаження викладачів).")
