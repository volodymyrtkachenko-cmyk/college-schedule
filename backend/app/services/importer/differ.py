from datetime import date
from typing import List, Dict, Any
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Schedule, Subject, Teacher, Group
from app.services.importer.parsers.kre_parser import ParsedWeek
from app.services.importer.normalizer import EntityNormalizer, clean_name

MAX_GROUP_NAME_LEN = 100
MAX_SUBJECT_NAME_LEN = 255
MAX_TEACHER_NAME_LEN = 255
MAX_ROOM_LEN = 100
VALID_WEEK_TYPES = {"numerator", "denominator", "both"}


def sanitize_room(room: str | None) -> str | None:
    if not isinstance(room, str):
        return None
    cleaned = clean_name(room)[:MAX_ROOM_LEN]
    return cleaned or None


class ScheduleDiffer:
    def __init__(self, db: AsyncSession, normalizer: EntityNormalizer):
        self.db = db
        self.normalizer = normalizer
        self.unresolved_entities = []

    async def diff(self, parsed_week: ParsedWeek) -> dict:
        substitutions = []
        unresolved_substitutions = []
        cancelled = []
        base_schedule_slots = []
        skipped_base_slots = []
        week_type = parsed_week.week_type if parsed_week.week_type in VALID_WEEK_TYPES else "both"

        # --- Auto-create missing entities ---
        for lesson in parsed_week.lessons:
            if lesson.group_name:
                cleaned_group = clean_name(lesson.group_name)[:MAX_GROUP_NAME_LEN]
                if cleaned_group and not self.normalizer.normalize_group(cleaned_group):
                    new_group = Group(name=cleaned_group, is_active=True)
                    self.db.add(new_group)
                    await self.db.flush()
                    self.normalizer.remember("group", lesson.group_name, new_group.id)
                    self.normalizer.remember("group", cleaned_group, new_group.id)
                    self.unresolved_entities.append({"type": "group", "raw": cleaned_group, "actual_id": new_group.id})

            if lesson.subject_name:
                cleaned_subj = clean_name(lesson.subject_name)[:MAX_SUBJECT_NAME_LEN]
                if cleaned_subj and not self.normalizer.normalize_subject(cleaned_subj):
                    new_subj = Subject(name=cleaned_subj, is_active=True)
                    self.db.add(new_subj)
                    await self.db.flush()
                    self.normalizer.remember("subject", lesson.subject_name, new_subj.id)
                    self.normalizer.remember("subject", cleaned_subj, new_subj.id)
                    self.unresolved_entities.append({"type": "subject", "raw": cleaned_subj, "actual_id": new_subj.id})

            if lesson.teacher_name:
                for t in lesson.teacher_name.split("/"):
                    t_name = clean_name(t)[:MAX_TEACHER_NAME_LEN]
                    if t_name and not self.normalizer.normalize_teacher(t_name):
                        new_teacher = Teacher(name=t_name, is_active=True)
                        self.db.add(new_teacher)
                        await self.db.flush()
                        self.normalizer.remember("teacher", t.strip(), new_teacher.id)
                        self.normalizer.remember("teacher", t_name, new_teacher.id)
                        self.unresolved_entities.append({"type": "teacher", "raw": t_name, "actual_id": new_teacher.id})

        # Flush only: entities are committed together with the import result,
        # so a failed import does not leave orphan groups/subjects/teachers.
        await self.db.flush()

        for lesson in parsed_week.lessons:
            if not isinstance(lesson.date, date):
                continue
            if lesson.date.isoweekday() not in range(1, 6):
                continue
            if not isinstance(lesson.lesson_number, int) or isinstance(lesson.lesson_number, bool) or not (1 <= lesson.lesson_number <= 4):
                continue

            group_id = None
            if lesson.group_name:
                group_id = self.normalizer.normalize_group(clean_name(lesson.group_name)[:MAX_GROUP_NAME_LEN])

            subject_id = None
            if lesson.subject_name:
                subject_id = self.normalizer.normalize_subject(clean_name(lesson.subject_name)[:MAX_SUBJECT_NAME_LEN])

            teacher_id = None
            second_teacher_id = None

            if lesson.teacher_name:
                t_names = [clean_name(t)[:MAX_TEACHER_NAME_LEN] for t in lesson.teacher_name.split("/")]
                if len(t_names) > 0 and t_names[0]:
                    teacher_id = self.normalizer.normalize_teacher(t_names[0])
                if len(t_names) > 1 and t_names[1]:
                    second_teacher_id = self.normalizer.normalize_teacher(t_names[1])
                if second_teacher_id is not None and second_teacher_id == teacher_id:
                    second_teacher_id = None

            sanitized_room = sanitize_room(lesson.room)
            teacher_unresolved = bool(lesson.teacher_name) and (teacher_id is None)

            if getattr(lesson, "is_cancelled", False):
                if group_id:
                    cancelled.append({
                        "date": lesson.date.isoformat(),
                        "lesson_number": lesson.lesson_number,
                        "group_id": group_id,
                        "week_type": week_type,
                    })
                continue

            if lesson.is_substitution:
                if subject_id and group_id and not teacher_unresolved:
                    substitutions.append({
                        "date": lesson.date.isoformat(),
                        "lesson_number": lesson.lesson_number,
                        "subject_id": subject_id,
                        "teacher_id": teacher_id,
                        "second_teacher_id": second_teacher_id,
                        "room": sanitized_room,
                        "group_id": group_id,
                        "week_type": week_type,
                        "is_explicit_substitution": True,
                    })
                else:
                    unresolved_substitutions.append({
                        "date": lesson.date.isoformat(),
                        "lesson_number": lesson.lesson_number,
                        "group": clean_name(lesson.group_name or "")[:MAX_GROUP_NAME_LEN] or None,
                        "subject": clean_name(lesson.subject_name or "")[:MAX_SUBJECT_NAME_LEN] or None,
                        "teacher": clean_name(lesson.teacher_name or "")[:MAX_TEACHER_NAME_LEN] or None,
                    })
            else:
                if subject_id and group_id and not teacher_unresolved:
                    base_schedule_slots.append({
                        "date": lesson.date.isoformat(),
                        "day_of_week": lesson.date.isoweekday(),
                        "lesson_number": lesson.lesson_number,
                        "group_id": group_id,
                        "subject_id": subject_id,
                        "teacher_id": teacher_id,
                        "second_teacher_id": second_teacher_id,
                        "room": sanitized_room,
                        "week_type": week_type,
                        "is_explicit_substitution": False,
                    })
                elif subject_id and group_id and teacher_unresolved:
                    skipped_base_slots.append({
                        "date": lesson.date.isoformat(),
                        "lesson_number": lesson.lesson_number,
                        "group": clean_name(lesson.group_name or "")[:MAX_GROUP_NAME_LEN] or None,
                        "subject": clean_name(lesson.subject_name or "")[:MAX_SUBJECT_NAME_LEN] or None,
                        "teacher": clean_name(lesson.teacher_name or "")[:MAX_TEACHER_NAME_LEN] or None,
                    })

        return {
            "unresolved": list({v['raw']: v for v in self.unresolved_entities}.values()),
            "unresolved_substitutions": unresolved_substitutions,
            "substitutions": substitutions,
            "cancelled": cancelled,
            "base_slots": base_schedule_slots,
            "skipped_base_slots": skipped_base_slots,
        }