"""Service for merging duplicate subjects (e.g. 'Інформатика*') and deduplicating group curriculums."""
from __future__ import annotations

from collections import defaultdict
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    AcademicEvent,
    Curriculum,
    EntityAlias,
    ImportedScheduleChange,
    Schedule,
    ScheduleOverride,
    SchedulePeriodSlot,
    ScheduleSlot,
    Subject,
)
from app.models.lesson_notes import LessonOccurrenceNote
from app.services.importer.normalizer import clean_name, name_key


def _subject_keeper_sort_key(subj: Subject) -> tuple:
    cleaned = clean_name(subj.name)
    has_asterisk = "*" in (subj.name or "")
    is_already_clean = (subj.name or "").strip() == cleaned and not has_asterisk
    return (
        0 if subj.is_active else 1,
        0 if is_already_clean else 1,
        0 if not has_asterisk else 1,
        0 if subj.short_name else 1,
        subj.id,
    )


def _curriculum_keeper_sort_key(
    curr: Curriculum,
    original_subject_names: dict[int, str],
) -> tuple:
    orig_subj_name = original_subject_names.get(curr.subject_id, "")
    has_asterisk = "*" in orig_subj_name
    return (
        -(curr.pairs_per_2_weeks or 0),
        -(curr.total_hours or 0),
        0 if not has_asterisk else 1,
        0 if (curr.is_fixed or curr.is_stream) else 1,
        curr.id,
    )


async def deduplicate_subjects_and_curriculums(db: AsyncSession) -> dict[str, int]:
    """
    1. Normalizes Subject names (removes '*', extra spaces) and merges duplicate Subject rows
       that share the same canonical `name_key`.
    2. Deduplicates Curriculum rows per `(group_id, canonical_subject_key)`, keeping the primary
       entry (highest pairs_per_2_weeks / total_hours / clean subject name) and removing duplicates.
    """
    all_subjects = (await db.scalars(select(Subject).order_by(Subject.id))).all()
    original_subject_names: dict[int, str] = {s.id: s.name or "" for s in all_subjects}

    subjects_by_key: dict[str, list[Subject]] = defaultdict(list)
    for subj in all_subjects:
        key = name_key(subj.name or "")
        if key:
            subjects_by_key[key].append(subj)

    all_curriculums = (await db.scalars(select(Curriculum).order_by(Curriculum.id))).all()

    subject_id_to_keeper: dict[int, Subject] = {}
    duplicate_subject_ids: list[int] = []
    renamed_subjects = 0

    for key, group_subjects in subjects_by_key.items():
        sorted_subjs = sorted(group_subjects, key=_subject_keeper_sort_key)
        keeper = sorted_subjs[0]
        subject_id_to_keeper[keeper.id] = keeper
        for dup in sorted_subjs[1:]:
            subject_id_to_keeper[dup.id] = keeper
            duplicate_subject_ids.append(dup.id)
            if not keeper.short_name and dup.short_name:
                keeper.short_name = dup.short_name
            if dup.is_active and not keeper.is_active:
                keeper.is_active = True

    # Group curriculums by (group_id, canonical subject key)
    curriculums_by_group_subject: dict[tuple[int, str], list[Curriculum]] = defaultdict(list)
    for curr in all_curriculums:
        orig_name = original_subject_names.get(curr.subject_id, "")
        subj_key = name_key(orig_name)
        if not subj_key:
            subj_key = f"__id_{curr.subject_id}"
        curriculums_by_group_subject[(curr.group_id, subj_key)].append(curr)

    removed_curriculums = 0
    affected_group_ids: set[int] = set()

    for (group_id, subj_key), curr_list in curriculums_by_group_subject.items():
        sorted_currs = sorted(
            curr_list,
            key=lambda c: _curriculum_keeper_sort_key(c, original_subject_names),
        )
        keeper_curr = sorted_currs[0]
        dups = sorted_currs[1:]

        if dups:
            affected_group_ids.add(group_id)
            max_total_hours = max((c.total_hours or 0) for c in curr_list)
            if (keeper_curr.total_hours or 0) == 0 and max_total_hours > 0:
                keeper_curr.total_hours = max_total_hours

            dup_curr_ids = [d.id for d in dups]

            # Repoint ScheduleSlot rows from duplicate curriculums to keeper_curr
            keeper_slots = (
                await db.scalars(
                    select(ScheduleSlot).where(ScheduleSlot.curriculum_id == keeper_curr.id)
                )
            ).all()
            existing_slot_keys = {
                (s.draft_id, s.day_of_week, s.lesson_number, s.week_type)
                for s in keeper_slots
            }

            dup_slots = (
                await db.scalars(
                    select(ScheduleSlot)
                    .where(ScheduleSlot.curriculum_id.in_(dup_curr_ids))
                    .order_by(ScheduleSlot.id)
                )
            ).all()
            for slot in dup_slots:
                slot_key = (slot.draft_id, slot.day_of_week, slot.lesson_number, slot.week_type)
                if slot_key in existing_slot_keys:
                    await db.delete(slot)
                else:
                    slot.curriculum_id = keeper_curr.id
                    existing_slot_keys.add(slot_key)

            await db.flush()

            for d in dups:
                await db.delete(d)
                removed_curriculums += 1

        # Point keeper curriculum to canonical keeper Subject
        target_subj = subject_id_to_keeper.get(keeper_curr.subject_id)
        if target_subj and keeper_curr.subject_id != target_subj.id:
            affected_group_ids.add(group_id)
            keeper_curr.subject_id = target_subj.id

    await db.flush()

    # Repoint other FK references for duplicate subjects and delete duplicate Subject rows
    merged_subjects = 0
    for key, group_subjects in subjects_by_key.items():
        sorted_subjs = sorted(group_subjects, key=_subject_keeper_sort_key)
        keeper = sorted_subjs[0]
        dups = sorted_subjs[1:]
        cleaned_keeper_name = clean_name(keeper.name or "")

        if dups:
            dup_ids = [d.id for d in dups]

            await db.execute(
                update(Schedule)
                .where(Schedule.subject_id.in_(dup_ids))
                .values(subject_id=keeper.id)
            )
            await db.execute(
                update(ScheduleOverride)
                .where(ScheduleOverride.subject_id.in_(dup_ids))
                .values(subject_id=keeper.id)
            )
            await db.execute(
                update(SchedulePeriodSlot)
                .where(SchedulePeriodSlot.subject_id.in_(dup_ids))
                .values(subject_id=keeper.id)
            )
            await db.execute(
                update(ImportedScheduleChange)
                .where(ImportedScheduleChange.subject_id.in_(dup_ids))
                .values(subject_id=keeper.id)
            )
            await db.execute(
                update(AcademicEvent)
                .where(AcademicEvent.subject_id.in_(dup_ids))
                .values(subject_id=keeper.id)
            )
            await db.execute(
                update(LessonOccurrenceNote)
                .where(LessonOccurrenceNote.subject_id.in_(dup_ids))
                .values(subject_id=keeper.id, subject_name=cleaned_keeper_name)
            )
            await db.execute(
                update(EntityAlias)
                .where(
                    EntityAlias.entity_type == "subject",
                    EntityAlias.actual_id.in_(dup_ids),
                )
                .values(actual_id=keeper.id)
            )
            await db.execute(
                update(Curriculum)
                .where(Curriculum.subject_id.in_(dup_ids))
                .values(subject_id=keeper.id)
            )
            await db.flush()

            for dup in dups:
                await db.delete(dup)
                merged_subjects += 1

            await db.flush()

        if cleaned_keeper_name and keeper.name != cleaned_keeper_name:
            keeper.name = cleaned_keeper_name
            renamed_subjects += 1
            await db.execute(
                update(LessonOccurrenceNote)
                .where(LessonOccurrenceNote.subject_id == keeper.id)
                .values(subject_name=cleaned_keeper_name)
            )

    await db.commit()

    from app.routers.directory import invalidate_directory_cache
    invalidate_directory_cache()

    return {
        "merged_subjects": merged_subjects,
        "renamed_subjects": renamed_subjects,
        "removed_curriculums": removed_curriculums,
        "affected_groups": len(affected_group_ids),
    }
