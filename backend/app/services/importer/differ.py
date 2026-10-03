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
        
        for lesson in parsed_week.lessons:
            group_id = self.normalizer.normalize_group(lesson.group_name) if lesson.group_name else None
            subject_id = self.normalizer.normalize_subject(lesson.subject_name) if lesson.subject_name else None
            teacher_id = self.normalizer.normalize_teacher(lesson.teacher_name) if lesson.teacher_name else None
            
            if lesson.group_name and not group_id:
                self.unresolved_entities.append({"type": "group", "raw": lesson.group_name})
            
            if lesson.subject_name and not subject_id:
                self.unresolved_entities.append({"type": "subject", "raw": lesson.subject_name})
                
            if lesson.teacher_name and not teacher_id:
                self.unresolved_entities.append({"type": "teacher", "raw": lesson.teacher_name})

            if getattr(lesson, "is_cancelled", False):
                if group_id:
                    cancelled.append({
                        "date": lesson.date,
                        "lesson_number": lesson.lesson_number,
                        "group_id": group_id
                    })
                continue

            if lesson.is_substitution:
                if subject_id and group_id:
                    substitutions.append({
                        "date": lesson.date,
                        "lesson_number": lesson.lesson_number,
                        "subject_id": subject_id,
                        "teacher_id": teacher_id,
                        "room": lesson.room,
                        "group_id": group_id
                    })
                else:
                    unresolved_substitutions.append({
                        "date": lesson.date,
                        "lesson_number": lesson.lesson_number,
                        "group": lesson.group_name,
                        "subject": lesson.subject_name,
                        "teacher": lesson.teacher_name
                    })
            else:
                if subject_id and group_id:
                    base_schedule_slots.append({
                        "day_of_week": lesson.date.isoweekday(),
                        "lesson_number": lesson.lesson_number,
                        "group_id": group_id,
                        "subject_id": subject_id,
                        "teacher_id": teacher_id,
                        "room": lesson.room,
                        "week_type": parsed_week.week_type
                    })
                
        return {
            "unresolved": list({v['raw']: v for v in self.unresolved_entities}.values()),
            "unresolved_substitutions": unresolved_substitutions,
            "substitutions": substitutions,
            "cancelled": cancelled,
            "base_slots": base_schedule_slots
        }