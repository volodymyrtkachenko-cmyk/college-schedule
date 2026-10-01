from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Subject, Teacher, Group
from app.models.entities import EntityAlias
from app.services.importer.parsers.kre_parser import ParsedWeek
import logging

logger = logging.getLogger(__name__)

class EntityNormalizer:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.aliases = {}
        self.subjects = {}
        self.teachers = {}
        self.groups = {}

    async def load_dictionaries(self):
        # Load aliases
        alias_rows = await self.db.scalars(select(EntityAlias))
        for row in alias_rows:
            self.aliases.setdefault(row.entity_type, {})[row.parsed_name.lower()] = row.actual_id

        # Load Actual entities
        subjects_rows = await self.db.scalars(select(Subject).where(Subject.is_active.is_(True)))
        self.subjects = {s.name.lower(): s.id for s in subjects_rows}

        teachers_rows = await self.db.scalars(select(Teacher).where(Teacher.is_active.is_(True)))
        self.teachers = {t.name.lower(): t.id for t in teachers_rows}

        groups_rows = await self.db.scalars(select(Group).where(Group.is_active.is_(True)))
        self.groups = {g.name.lower(): g.id for g in groups_rows}

    def normalize_subject(self, parsed_name: str) -> int | None:
        name_lower = parsed_name.lower().strip()
        if name_lower in self.aliases.get("subject", {}):
            return self.aliases["subject"][name_lower]
        return self.subjects.get(name_lower)

    def normalize_teacher(self, parsed_name: str) -> int | None:
        name_lower = parsed_name.lower().strip()
        if name_lower in self.aliases.get("teacher", {}):
            return self.aliases["teacher"][name_lower]
        return self.teachers.get(name_lower)

    def normalize_group(self, parsed_name: str) -> int | None:
        name_lower = parsed_name.lower().strip()
        if name_lower in self.aliases.get("group", {}):
            return self.aliases["group"][name_lower]
        return self.groups.get(name_lower)
