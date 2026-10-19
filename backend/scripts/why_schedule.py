#!/usr/bin/env python3
"""CLI tool: 'Чому так?' (Why this schedule result?).

Usage:
    python -m scripts.why_schedule --group 85 --date 2026-10-26
    python -m scripts.why_schedule --group 85 --start 2026-10-19 --end 2026-10-25
"""
import argparse
import asyncio
import os
import sys
from datetime import date, datetime, timedelta

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.database import async_session_factory
from app.models.entities import Group, Teacher
from app.services.why_schedule import explain_schedule_slot


def format_slot_report(exp: dict) -> str:
    q = exp["query"]
    layers = exp["layers"]
    ver = layers["version"]["active_version"]
    wt = layers["week_type"]
    
    lines = []
    lines.append("=" * 80)
    lines.append(f"ДІАГНОСТИКА 'ЧОМУ ТАК?': Дата {q['date']} (День {q['weekday']}) | Група: {q['group_name']} (id={q['group_id']})")
    lines.append("-" * 80)
    lines.append(f"1. ВЕРСІЯ: {ver['name']} (id={ver['id']}, {ver['valid_from']}..{ver['valid_until']}) [is_active={ver['is_active']}]" if ver else "1. ВЕРСІЯ: Не знайдено активної версії!")
    lines.append(f"2. ТИП ТИЖНЯ: {wt['label']} ({wt['type']})")
    lines.append(f"   Розрахунок: {wt['calculation']}")
    
    # Periods
    periods = layers["calendar_periods"]
    applied_p = [p for p in periods if p["applies_to_target"]]
    if applied_p:
        lines.append(f"3. ГРАФІК ПРОЦЕСУ: Знайдено перекриття ({len(applied_p)}):")
        for p in applied_p:
            lines.append(f"   - {p['name']} ({p['period_type']}, {p['dates']}) [global={p['is_global']}]")
    else:
        lines.append("3. ГРАФІК ПРОЦЕСУ: Перекриттів немає (звичайне навчання).")

    # Template
    tpl_sum = layers["template_summary"]
    lines.append(f"4. ШАБЛОН РОЗКЛАДУ: Знайдено пар для поточного типу тижня: {tpl_sum['matching_slots_count']}. Для іншого типу: {tpl_sum['other_week_slots_count']}.")
    
    # Slots
    lines.append("\n5. ПОПАРОЧНИЙ РОЗБІР (СЛОТИ 1..4):")
    for s in exp["slots"]:
        l_num = s["lesson_number"]
        eff = s["effective_lesson"]
        lines.append(f"  --- ПАРА #{l_num}: {eff['summary']} [Джерело: {eff.get('source')}] ---")
        
        if s["template"]:
            if "notice" in s["template"]:
                lines.append(f"      [Шаблон]: {s['template']['notice']}")
            else:
                lines.append(f"      [Шаблон]: {s['template']['subject']} ({s['template']['teacher']}, ауд. {s['template']['room']}) [{s['template']['week_type']}]")
        else:
            lines.append("      [Шаблон]: Порожньо")
            
        if s["period_override"]:
            lines.append(f"      [Графік]: {s['period_override']}")
        if s["imported_change"]:
            lines.append(f"      [Імпорт]: {s['imported_change']}")
        if s["manual_override"]:
            lines.append(f"      [Ручна дія]: {s['manual_override']}")
        if s["event"]:
            lines.append(f"      [Подія]: {s['event']}")
            
        if s["meeting_links"]:
            for m in s["meeting_links"]:
                arch_tag = " [АРХІВНЕ]" if m["archived"] else ""
                lines.append(f"      [Посилання]: {m['link']} (джерело note: {m['origin_kind']}){arch_tag}")
        if s["homework_tasks"]:
            for hw in s["homework_tasks"]:
                arch_tag = " [АРХІВНЕ]" if hw["archived"] else ""
                lines.append(f"      [ДЗ]: {hw['task']}{arch_tag}")
                
        if s["anomaly_warning"]:
            lines.append(f"      >>> {s['anomaly_warning']}")
            
    lines.append("=" * 80)
    return "\n".join(lines)


async def main():
    parser = argparse.ArgumentParser(description="Explain schedule layers ('Чому так?')")
    parser.add_argument("--group", help="Group ID or name (e.g. 85)")
    parser.add_argument("--teacher", help="Teacher ID or name")
    parser.add_argument("--date", help="Target date YYYY-MM-DD")
    parser.add_argument("--start", help="Start date YYYY-MM-DD")
    parser.add_argument("--end", help="End date YYYY-MM-DD")
    args = parser.parse_args()

    async with async_session_factory() as db:
        group_id = None
        if args.group:
            if args.group.isdigit():
                g = await db.get(Group, int(args.group))
                group_id = g.id if g else int(args.group)
            else:
                g = await db.scalar(select(Group).where(Group.name.ilike(f"%{args.group}%")))
                if g:
                    group_id = g.id
                else:
                    print(f"Групу '{args.group}' не знайдено!")
                    return

        teacher_id = None
        if args.teacher:
            if args.teacher.isdigit():
                teacher_id = int(args.teacher)
            else:
                t = await db.scalar(select(Teacher).where(Teacher.name.ilike(f"%{args.teacher}%")))
                if t:
                    teacher_id = t.id
                else:
                    print(f"Викладача '{args.teacher}' не знайдено!")
                    return

        dates = []
        if args.date:
            dates = [datetime.strptime(args.date, "%Y-%m-%d").date()]
        elif args.start and args.end:
            d_cur = datetime.strptime(args.start, "%Y-%m-%d").date()
            d_end = datetime.strptime(args.end, "%Y-%m-%d").date()
            while d_cur <= d_end:
                if d_cur.isoweekday() <= 5:  # Mon..Fri
                    dates.append(d_cur)
                d_cur += timedelta(days=1)
        else:
            dates = [date.today()]

        for d in dates:
            exp = await explain_schedule_slot(db, d, group_id=group_id, teacher_id=teacher_id)
            print(format_slot_report(exp))


if __name__ == "__main__":
    asyncio.run(main())
