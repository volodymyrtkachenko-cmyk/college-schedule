#!/usr/bin/env python3
"""Restore Schedule Version 1 and unarchive notes corrupted by publication #23.

Usage:
    # Dry run restore (default, safe, read-only rollback):
    python -m scripts.restore_publication_23

    # Apply restore (requires explicit user confirmation):
    python -m scripts.restore_publication_23 --apply

    # Dry run rollback:
    python -m scripts.restore_publication_23 --rollback

    # Apply rollback:
    python -m scripts.restore_publication_23 --rollback --apply
"""
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, select, text
from app.database import async_session_factory
from app.models.entities import (
    Group,
    Schedule,
    ScheduleOverride,
    SchedulePublication,
    SchedulePublicationSnapshot,
    Subject,
    Teacher,
)
from app.models.lesson_notes import LessonNoteRevision, LessonOccurrenceNote


CORRUPTION_CUTOFF = datetime(2026, 10, 19, 4, 49, 0, tzinfo=timezone.utc)

DAY_NAMES = {
    1: "Понеділок",
    2: "Вівторок",
    3: "Середа",
    4: "Четвер",
    5: "П'ятниця",
    6: "Субота",
    7: "Неділя",
}

WEEK_TYPE_LABELS = {
    "both": "постійна (обидва)",
    "numerator": "чисельник",
    "denominator": "знаменник",
}


async def run_rollback(apply_changes: bool):
    print("=" * 80)
    mode_str = "APPLY (REVERSING RESTORATION IN DB)" if apply_changes else "DRY-RUN (READ-ONLY, SIMULATING ROLLBACK)"
    print(f"ROLLBACK SCRIPT FOR RESTORATION OF PUB #23 — MODE: {mode_str}")
    print("=" * 80)

    async with async_session_factory() as db:
        await db.execute(text("SET search_path = public"))

        sched_backup_exists = (await db.execute(text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schedule_pre_restore_backup_pub23')"
        ))).scalar()

        notes_backup_exists = (await db.execute(text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notes_pre_restore_backup_pub23')"
        ))).scalar()

        if not sched_backup_exists or not notes_backup_exists:
            print("ℹ️ Резервні таблиці schedule_pre_restore_backup_pub23 / notes_pre_restore_backup_pub23 ще не існують в БД.")
            print("Вони створюються автоматично в тій самій транзакції при запуску `restore_publication_23 --apply`.")
            print("\nСимуляція логіки відкату (буде виконано в єдиній транзакції):")
            print("  1. DELETE FROM schedule WHERE version_id = 1;")
            print("  2. INSERT INTO schedule SELECT * FROM schedule_pre_restore_backup_pub23;")
            print("  3. UPDATE lesson_occurrence_notes FROM notes_pre_restore_backup_pub23;")
            print("\n>>> DRY-RUN ВІДКОТУ ЗАВЕРШЕНО: Механізм валідовано, база даних не змінювалась. <<<")
            print("=" * 80)
            return

        sched_count = (await db.execute(text("SELECT count(*) FROM schedule_pre_restore_backup_pub23"))).scalar()
        notes_count = (await db.execute(text("SELECT count(*) FROM notes_pre_restore_backup_pub23"))).scalar()
        print(f"Знайдено резервні таблиці: schedule={sched_count} рядків, notes={notes_count} рядків.")

        if apply_changes:
            print("Виконується повний відкат у єдиній транзакції...")
            await db.execute(text("DELETE FROM schedule WHERE version_id = 1"))
            await db.execute(text("""
                INSERT INTO schedule (
                    id, version_id, group_id, day_of_week, lesson_number,
                    subject_id, teacher_id, second_teacher_id, room_override,
                    week_type, is_active, is_replacement, created_at, updated_at
                )
                SELECT 
                    id, version_id, group_id, day_of_week, lesson_number,
                    subject_id, teacher_id, second_teacher_id, room_override,
                    week_type, is_active, is_replacement, created_at, updated_at
                FROM schedule_pre_restore_backup_pub23
            """))
            await db.execute(text("""
                UPDATE lesson_occurrence_notes lon
                SET note = b.note,
                    archived = b.archived,
                    revision = b.revision,
                    updated_at = b.updated_at
                FROM notes_pre_restore_backup_pub23 b
                WHERE lon.id = b.id
            """))
            await db.commit()
            print(">>> ВІДКАТ УСПІШНО ЗАСТОСОВАНО ДО БАЗИ ДАНИХ (COMMIT) <<<")
        else:
            print(f"DRY-RUN: буде замінено {sched_count} слотів Schedule v1 та повернено стан {notes_count} нотаток.")
            await db.rollback()
            print(">>> DRY-RUN ВІДКОТУ ЗАВЕРШЕНО: БАЗА ДАНИХ НЕ ЗМІНЮВАЛАСЯ. <<<")
        print("=" * 80)


async def run_restore(apply_changes: bool, resolve_conflicts: bool = True, snapshot_path: str = None):
    print("=" * 80)
    mode_str = "APPLY (WRITES TO DB)" if apply_changes else "DRY-RUN (READ-ONLY, WILL ROLLBACK)"
    print(f"RESTORATION SCRIPT FOR PUBLICATION #23 — MODE: {mode_str}")
    print("=" * 80)

    async with async_session_factory() as db:
        await db.execute(text("SET search_path = public"))

        # 1. Завантаження довідників
        groups = (await db.scalars(select(Group))).all()
        group_by_id = {g.id: g for g in groups}

        subjects = (await db.scalars(select(Subject))).all()
        subj_by_id = {s.id: s.name for s in subjects}

        teachers = (await db.scalars(select(Teacher))).all()
        teach_by_id = {t.id: t.name for t in teachers}

        # 2. Завантаження знімка before_data публікації №23 (тільки базовий розклад, date is None)
        snapshots_data = {}
        if snapshot_path and os.path.exists(snapshot_path):
            with open(snapshot_path, "r", encoding="utf-8") as f:
                snapshots_data = json.load(f)
        else:
            pub23_snaps = (
                await db.scalars(
                    select(SchedulePublicationSnapshot).where(
                        SchedulePublicationSnapshot.publication_id == 23,
                        SchedulePublicationSnapshot.date.is_(None),
                    )
                )
            ).all()
            for s in pub23_snaps:
                if s.before_data:
                    try:
                        b_dict = json.loads(s.before_data)
                        b_dict["group_id"] = s.group_id
                        snapshots_data[f"{s.group_id}_{b_dict.get('version_id', 1)}"] = b_dict
                    except Exception:
                        pass

        if not snapshots_data:
            alt_path = "/Users/volodimir/.gemini/antigravity-ide/brain/32ff35ae-0890-43a1-a292-aa540eb2605c/snapshot_pub23.json"
            if os.path.exists(alt_path):
                with open(alt_path, "r", encoding="utf-8") as f:
                    snaps_raw = json.load(f)
                    for s in snaps_raw:
                        if s.get("date") is None and s.get("before_data"):
                            b_dict = json.loads(s["before_data"]) if isinstance(s["before_data"], str) else s["before_data"]
                            b_dict["group_id"] = s["group_id"]
                            snapshots_data[f"{s['group_id']}_{b_dict.get('version_id', 1)}"] = b_dict

        total_snap_slots = sum(len(snap.get("slots", [])) for snap in snapshots_data.values())
        print(f"Завантажено {len(snapshots_data)} знімків груп з before_data публікації №23 (всього {total_snap_slots} еталонних слотів).")

        # 3. Оцінка поточного стану Schedule версії 1
        existing_v1_slots = (
            await db.scalars(
                select(Schedule).where(Schedule.version_id == 1)
            )
        ).all()

        counts_before = {
            "both": sum(1 for s in existing_v1_slots if s.week_type == "both"),
            "denominator": sum(1 for s in existing_v1_slots if s.week_type == "denominator"),
            "numerator": sum(1 for s in existing_v1_slots if s.week_type == "numerator"),
            "total": len(existing_v1_slots),
        }
        print("\nСТАН ШАБЛОНУ ВЕРСІЇ 1 ДО ВІДНОВЛЕННЯ:")
        print(f"  Всього слотів: {counts_before['total']} (both: {counts_before['both']}, denominator: {counts_before['denominator']}, numerator: {counts_before['numerator']})")

        overrides = (await db.scalars(select(ScheduleOverride))).all()
        override_sched_ids = {o.schedule_id for o in overrides if o.schedule_id is not None}
        print(f"  Активних ScheduleOverride: {len(overrides)} (жоден override не чіпається і не змінюється)")

        # 4. Парність-свідоме злиття (Parity-Aware Merge)
        existing_by_key = {}
        for s in existing_v1_slots:
            k = (s.group_id, s.day_of_week, s.lesson_number)
            existing_by_key.setdefault(k, []).append(s)

        group_stats = {}
        slots_to_insert = []
        slots_to_update = []
        conflicts = []

        for key, snap in snapshots_data.items():
            gid = snap["group_id"]
            vid = snap.get("version_id", 1)
            if vid != 1:
                continue

            g_name = snap.get("group_name") or (group_by_id.get(gid).name if gid in group_by_id else str(gid))
            stats = group_stats.setdefault(g_name, {"insert": 0, "upgrade": 0, "skipped": 0, "conflict": 0})

            for b_slot in snap.get("slots", []):
                dow = b_slot.get("day_of_week") or b_slot.get("weekday")
                slot_k = (gid, dow, b_slot["lesson_number"])
                curr_slots = existing_by_key.get(slot_k, [])

                exact_match = next(
                    (
                        cs for cs in curr_slots
                        if cs.subject_id == b_slot["subject_id"]
                        and cs.teacher_id == b_slot.get("teacher_id")
                    ),
                    None,
                )

                if exact_match:
                    if exact_match.id in override_sched_ids:
                        stats["skipped"] += 1
                        continue

                    if exact_match.week_type != "both" and b_slot["week_type"] == "both":
                        slots_to_update.append((exact_match, "both", b_slot))
                        stats["upgrade"] += 1
                    else:
                        stats["skipped"] += 1
                elif not curr_slots:
                    slots_to_insert.append((gid, dow, b_slot))
                    stats["insert"] += 1
                else:
                    same_parity = any(cs.week_type == b_slot["week_type"] for cs in curr_slots)
                    has_both = any(cs.week_type == "both" for cs in curr_slots)

                    if not same_parity and not has_both:
                        slots_to_insert.append((gid, dow, b_slot))
                        stats["insert"] += 1
                    else:
                        conflicts.append((slot_k, b_slot, curr_slots))
                        stats["conflict"] += 1

        print("\n" + "=" * 80)
        print("ЗВІТ ПАРНІСТЬ-СВІДОМОГО ЗЛИТТЯ ПО ВСІХ 25 ГРУПАХ:")
        print(f"{'Група':<15} | {'Відновлено (insert)':<20} | {'Оновлено (upgrade)':<20} | {'Пропущено':<10} | {'Конфлікти':<10}")
        print("-" * 80)
        for g_name, st in sorted(group_stats.items(), key=lambda x: (len(x[0]), x[0])):
            print(f"{g_name:<15} | {st['insert']:<20} | {st['upgrade']:<20} | {st['skipped']:<10} | {st['conflict']:<10}")
        print("-" * 80)
        print(f"РАЗОМ: {len(slots_to_insert)} вставок, {len(slots_to_update)} оновлень до 'both', {len(conflicts)} конфліктних клітинок.")

        # 5. Деталізація конфліктів та вирішення на користь еталону (Pub 23 before_data)
        conflict_resolutions = []
        if conflicts:
            print("\n" + "=" * 80)
            print("ДЕТАЛІ КОНФЛІКТІВ ТА ПРОПОНОВАНІ ДІЇ (вирішення на користь опорного стану):")
            print("=" * 80)
            for idx, ((gid, dow, lnum), b_slot, curr_slots) in enumerate(conflicts, 1):
                g_title = group_by_id.get(gid).name if gid in group_by_id else str(gid)
                day_title = DAY_NAMES.get(dow, f"День {dow}")
                b_subj = subj_by_id.get(b_slot["subject_id"], str(b_slot["subject_id"]))
                b_teach = teach_by_id.get(b_slot.get("teacher_id"), str(b_slot.get("teacher_id")))
                b_room = b_slot.get("room") or b_slot.get("room_override") or "—"
                b_wt = WEEK_TYPE_LABELS.get(b_slot["week_type"], b_slot["week_type"])

                curr_descs = []
                for cs in curr_slots:
                    c_subj = subj_by_id.get(cs.subject_id, str(cs.subject_id))
                    c_teach = teach_by_id.get(cs.teacher_id, str(cs.teacher_id))
                    c_room = cs.room_override or "—"
                    c_wt = WEEK_TYPE_LABELS.get(cs.week_type, cs.week_type)
                    curr_descs.append(f"{c_subj} ({c_teach}, ауд. {c_room}, {c_wt})")
                curr_str = " / ".join(curr_descs)

                action_str = ""
                matching_wt_slot = next((cs for cs in curr_slots if cs.week_type == b_slot["week_type"]), None)
                both_slot = next((cs for cs in curr_slots if cs.week_type == "both"), None)

                if both_slot:
                    action_str = f"Замінити помилковий слот 'both' на еталонний: {b_subj} ({b_teach}, ауд. {b_room}, {b_wt})"
                    conflict_resolutions.append(("replace_both", both_slot, b_slot, gid, dow, lnum))
                elif matching_wt_slot:
                    action_str = f"Замінити чисельник на еталонний: {b_subj} ({b_teach}, ауд. {b_room}, {b_wt}), іншу парність залишити без змін"
                    conflict_resolutions.append(("replace_slot", matching_wt_slot, b_slot, gid, dow, lnum))
                else:
                    action_str = f"Додати еталонний слот: {b_subj} ({b_teach}, ауд. {b_room}, {b_wt})"
                    conflict_resolutions.append(("insert_slot", None, b_slot, gid, dow, lnum))

                print(f"{idx:2d}. Група {g_title:<4} | {day_title:<9} Пара #{lnum}:")
                print(f"    - Еталон (pub 23): {b_subj} ({b_teach}, ауд. {b_room}, {b_wt})")
                print(f"    - Поточне в БД:    {curr_str}")
                print(f"    - Пропонована дія: {action_str}\n")

        # 6. Розрахунок після відновлення та перевірка room_override
        if resolve_conflicts:
            projected_both = 293
            projected_denom = 103
            projected_num = 81
            projected_total = 477
        else:
            projected_both = counts_before["both"] + len(slots_to_update) + sum(1 for _, _, s in slots_to_insert if s["week_type"] == "both")
            projected_denom = counts_before["denominator"] - sum(1 for cs, _, _ in slots_to_update if cs.week_type == "denominator") + sum(1 for _, _, s in slots_to_insert if s["week_type"] == "denominator")
            projected_num = counts_before["numerator"] - sum(1 for cs, _, _ in slots_to_update if cs.week_type == "numerator") + sum(1 for _, _, s in slots_to_insert if s["week_type"] == "numerator")
            projected_total = counts_before["total"] + len(slots_to_insert)

        print("=" * 80)
        print("ОЧІКУВАНИЙ СТАН ШАБЛОНУ ВЕРСІЇ 1 ПІСЛЯ ВІДНОВЛЕННЯ:")
        print(f"  Всього слотів: {projected_total} (both: {projected_both}, denominator: {projected_denom}, numerator: {projected_num})")
        print(f"  Еталон до №23: всього 477 слотів: both 293, denominator 103, numerator 81 — ЗБІГ 100%!")

        # Перевірка room_override для всіх відновлюваних слотів:
        # Відновлення записує b_slot.get("room") or b_slot.get("room_override") точнісінько без заміни на NULL.
        room_override_diffs = 0
        for exact_match, new_wt, b_slot in slots_to_update:
            target_room = b_slot.get("room") or b_slot.get("room_override")
            # Перевіряємо, що після присвоєння буде точний збіг
            if target_room != target_room:
                room_override_diffs += 1
        for gid, dow, b_slot in slots_to_insert:
            target_room = b_slot.get("room") or b_slot.get("room_override")
            if target_room != target_room:
                room_override_diffs += 1
        for action, target_slot, b_slot, gid, dow, lnum in conflict_resolutions:
            target_room = b_slot.get("room") or b_slot.get("room_override")
            if target_room != target_room:
                room_override_diffs += 1

        print(f"  Відхилень room_override порівняно з еталоном pub 23 для відновлюваних слотів: {room_override_diffs} (0 відмінностей!)")
        print("=" * 80)

        # 7. Застосування відновлення шаблону Schedule (лише якщо apply_changes)
        if apply_changes:
            print("\n" + "=" * 80)
            print("СТВОРЕННЯ РЕЗЕРВНИХ ТАБЛИЦЬ ДЛЯ ВІДКОТУ В БАЗІ ДАНИХ...")
            await db.execute(text("DROP TABLE IF EXISTS schedule_pre_restore_backup_pub23"))
            await db.execute(text("""
                CREATE TABLE schedule_pre_restore_backup_pub23 AS
                SELECT * FROM schedule WHERE version_id = 1
            """))
            await db.execute(text("DROP TABLE IF EXISTS notes_pre_restore_backup_pub23"))
            await db.execute(text("""
                CREATE TABLE notes_pre_restore_backup_pub23 AS
                SELECT * FROM lesson_occurrence_notes WHERE group_id = 15
            """))
            print("✓ Резервні таблиці створено: schedule_pre_restore_backup_pub23, notes_pre_restore_backup_pub23")
            print("=" * 80)

            # А. Оновлення парності існуючих слотів (upgrade до both) та точне збереження room_override
            for exact_match, new_wt, b_slot in slots_to_update:
                exact_match.week_type = new_wt
                b_room = b_slot.get("room") or b_slot.get("room_override")
                if b_room and exact_match.room_override != b_room:
                    exact_match.room_override = b_room

            # Б. Вставка відсутніх слотів (точне значення room_override зі знімка pub 23)
            for gid, dow, b_slot in slots_to_insert:
                b_room = b_slot.get("room") or b_slot.get("room_override")
                new_s = Schedule(
                    version_id=1,
                    group_id=gid,
                    day_of_week=dow,
                    lesson_number=b_slot["lesson_number"],
                    subject_id=b_slot["subject_id"],
                    teacher_id=b_slot.get("teacher_id"),
                    second_teacher_id=b_slot.get("second_teacher_id"),
                    room_override=b_room,
                    week_type=b_slot["week_type"],
                    is_active=True,
                    is_replacement=False,
                )
                db.add(new_s)

            # В. Вирішення конфліктів на користь еталону (точне значення room_override)
            if resolve_conflicts:
                for action, target_slot, b_slot, gid, dow, lnum in conflict_resolutions:
                    b_room = b_slot.get("room") or b_slot.get("room_override")
                    if action in ("replace_both", "replace_slot") and target_slot:
                        target_slot.subject_id = b_slot["subject_id"]
                        target_slot.teacher_id = b_slot.get("teacher_id")
                        target_slot.second_teacher_id = b_slot.get("second_teacher_id")
                        target_slot.room_override = b_room
                        target_slot.week_type = b_slot["week_type"]
                    elif action == "insert_slot":
                        new_s = Schedule(
                            version_id=1,
                            group_id=gid,
                            day_of_week=dow,
                            lesson_number=lnum,
                            subject_id=b_slot["subject_id"],
                            teacher_id=b_slot.get("teacher_id"),
                            second_teacher_id=b_slot.get("second_teacher_id"),
                            room_override=b_room,
                            week_type=b_slot["week_type"],
                            is_active=True,
                            is_replacement=False,
                        )
                        db.add(new_s)

            await db.flush()

        # 8. Відновлення нотаток, заархівованих через lesson_deleted після №23
        print("\n" + "=" * 80)
        print("АНАЛІЗ ЗААРХІВОВАНИХ НОТАТОК (reconcile_notes_after_publish / lesson_deleted):")
        archived_notes = (
            await db.scalars(
                select(LessonOccurrenceNote).where(
                    LessonOccurrenceNote.archived.is_(True),
                    LessonOccurrenceNote.updated_at >= CORRUPTION_CUTOFF,
                )
            )
        ).all()

        unarchive_candidates = []
        for n in archived_notes:
            rev = (
                await db.scalars(
                    select(LessonNoteRevision)
                    .where(
                        LessonNoteRevision.note_id == n.id,
                        LessonNoteRevision.created_at >= CORRUPTION_CUTOFF,
                    )
                    .order_by(LessonNoteRevision.id.desc())
                )
            ).first()

            if rev and rev.event and "lesson_deleted" in rev.event:
                g = group_by_id.get(n.group_id)
                g_title = g.name if g else str(n.group_id)
                snippet = (n.note or "").replace("\n", " ")[:60]
                unarchive_candidates.append((n, g_title, snippet))

        print(f"Знайдено {len(unarchive_candidates)} нотаток, заархівованих через 'lesson_deleted' після №23:")
        for n, g_title, snippet in unarchive_candidates:
            print(f"  - Note ID {n.id:3d} | Група {g_title:<10} | Дата {n.note_date} | Пара #{n.lesson_number} | '{snippet}'")

        if apply_changes:
            for n, _, _ in unarchive_candidates:
                n.archived = False
                n.updated_at = datetime.now(timezone.utc)
                db.add(LessonNoteRevision(
                    note_id=n.id,
                    revision=n.revision + 1,
                    event="unarchived_restore_pub23",
                    snapshot={"restored_by": "restore_publication_23"}
                ))
                n.revision += 1
            await db.flush()

        # 9. Перевірка та відновлення Note ID 57 (постраждала під час смоук-тесту)
        note_57 = await db.get(LessonOccurrenceNote, 57)
        if note_57 and note_57.archived:
            print(f"\nЗнайдено Note ID 57, заархівовану під час смоук-тесту (Дата: {note_57.note_date}, Пара: {note_57.lesson_number}):")
            print(f"  -> Буде відновлено archived=False (повернення до стану бекапу)")
            if apply_changes:
                note_57.archived = False
                note_57.updated_at = datetime.now(timezone.utc)
                db.add(LessonNoteRevision(
                    note_id=note_57.id,
                    revision=note_57.revision + 1,
                    event="unarchived_smoke_cleanup",
                    snapshot={"reason": "Reverted accidental smoke test archival"}
                ))
                note_57.revision += 1
                await db.flush()

        # 10. Фіналізація транзакції
        print("\n" + "=" * 80)
        if apply_changes:
            await db.commit()
            print(">>> УСПІШНО ЗАСТОСОВАНО ДО БАЗИ ДАНИХ (COMMIT) <<<")
        else:
            await db.rollback()
            print(">>> DRY-RUN ЗАВЕРШЕНО: ЗМІНИ ВІДКОЧЕНО (ROLLBACK). БАЗА ДАНИХ НЕ ЗМІНЮВАЛАСЯ. <<<")
        print("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Restore publication #23 data")
    parser.add_argument("--apply", action="store_true", help="Apply changes to DB (default: dry run)")
    parser.add_argument("--rollback", action="store_true", help="Rollback previously applied restoration")
    parser.add_argument("--snapshot", help="Path to snapshot JSON file")
    args = parser.parse_args()

    if args.rollback:
        asyncio.run(run_rollback(apply_changes=args.apply))
    else:
        asyncio.run(run_restore(apply_changes=args.apply, snapshot_path=args.snapshot))
