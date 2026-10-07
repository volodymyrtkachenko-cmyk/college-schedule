from datetime import date
from typing import List, Dict, Any
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Schedule, Subject, Teacher, Group
from app.services.importer.parsers.kre_parser import ParsedWeek
from app.services.importer.normalizer import EntityNormalizer

class ScheduleDiffer:
    def __init__(self, db: AsyncSession, normalizer: EntityNormalizer):
        self.db = db
        self.normalizer = normalizer
        self.unresolved_entities = []

    async def _get_current_schedule(self, start_date: date, end_date: date) -> Dict[str, Any]:
        # Implementation depends on logic structure
        # E.g. get all entries from schedule table for the week days ...
        pass

    async def diff(self, parsed_week: ParsedWeek) -> dict:
        substitutions = []
        unresolved_substitutions = []
        cancelled = []
        base_schedule_slots = []
        skipped_base_slots = []
        
        # --- Auto-create missing entities ---
        for lesson in parsed_week.lessons:
            if lesson.group_name and not self.normalizer.normalize_group(lesson.group_name):
                new_group = Group(name=lesson.group_name, is_active=True)
                self.db.add(new_group)
                await self.db.flush()
                self.normalizer.groups[lesson.group_name.lower().strip()] = new_group.id
                self.unresolved_entities.append({"type": "group", "raw": lesson.group_name})
            
            if lesson.subject_name and not self.normalizer.normalize_subject(lesson.subject_name):
                new_subj = Subject(name=lesson.subject_name, is_active=True)
                self.db.add(new_subj)
                await self.db.flush()
                self.normalizer.subjects[lesson.subject_name.lower().strip()] = new_subj.id
                self.unresolved_entities.append({"type": "subject", "raw": lesson.subject_name})
                
            if lesson.teacher_name:
                for t in lesson.teacher_name.split("/"):
                    t_name = t.strip()
                    if t_name and not self.normalizer.normalize_teacher(t_name):
                        new_teacher = Teacher(name=t_name, is_active=True)
                        self.db.add(new_teacher)
                        await self.db.flush()
                        self.normalizer.teachers[t_name.lower().strip()] = new_teacher.id
                        self.unresolved_entities.append({"type": "teacher", "raw": t_name})

        # Commit to ensure IDs are persistent
        await self.db.commit()

        for lesson in parsed_week.lessons:
            group_id = None
            if lesson.group_name:
                group_id = self.normalizer.normalize_group(lesson.group_name)
            
            subject_id = None
            if lesson.subject_name:
                subject_id = self.normalizer.normalize_subject(lesson.subject_name)
            
            teacher_id = None
            second_teacher_id = None
            
            if lesson.teacher_name:
                t_names = [t.strip() for t in lesson.teacher_name.split("/")]
                if len(t_names) > 0 and t_names[0]:
                    teacher_id = self.normalizer.normalize_teacher(t_names[0])
                if len(t_names) > 1 and t_names[1]:
                    second_teacher_id = self.normalizer.normalize_teacher(t_names[1])

            teacher_unresolved = bool(lesson.teacher_name) and (teacher_id is None)

            if getattr(lesson, "is_cancelled", False):
                if group_id:
                    cancelled.append({
                        "date": lesson.date.isoformat(),
                        "lesson_number": lesson.lesson_number,
                        "group_id": group_id,
                        "week_type": parsed_week.week_type,
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
                        "room": lesson.room,
                        "group_id": group_id,
                        "week_type": parsed_week.week_type,
                    })
                else:
                    unresolved_substitutions.append({
                        "date": lesson.date.isoformat(),
                        "lesson_number": lesson.lesson_number,
                        "group": lesson.group_name,
                        "subject": lesson.subject_name,
                        "teacher": lesson.teacher_name
                    })
            else:
                if subject_id and group_id and not teacher_unresolved:
                    base_schedule_slots.append({
                        "day_of_week": lesson.date.isoweekday(),
                        "lesson_number": lesson.lesson_number,
                        "group_id": group_id,
                        "subject_id": subject_id,
                        "teacher_id": teacher_id,
                        "second_teacher_id": second_teacher_id,
                        "room": lesson.room,
                        "week_type": parsed_week.week_type
                    })
                elif subject_id and group_id and teacher_unresolved:
                    skipped_base_slots.append({
                        "date": lesson.date.isoformat(),
                        "lesson_number": lesson.lesson_number,
                        "group": lesson.group_name,
                        "subject": lesson.subject_name,
                        "teacher": lesson.teacher_name,
                    })

        return {
            "unresolved": list({v['raw']: v for v in self.unresolved_entities}.values()),
            "unresolved_substitutions": unresolved_substitutions,
            "substitutions": substitutions,
            "cancelled": cancelled,
            "base_slots": base_schedule_slots,
            "skipped_base_slots": skipped_base_slots,
        }