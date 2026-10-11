from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Subject, Teacher, Group
from app.models.entities import EntityAlias
from app.services.importer.parsers.kre_parser import ParsedWeek
import logging
import re

logger = logging.getLogger(__name__)


def clean_name(value: str) -> str:
    """Display-safe name: collapsed whitespace, no trailing '*' markers."""
    return " ".join(value.replace("*", " ").split()).strip()


def name_key(value: str) -> str:
    """Comparison key: case-insensitive, apostrophe-insensitive."""
    key = clean_name(value).casefold()
    return re.sub(r"[’ʼ`]", "'", key)


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
            self.aliases.setdefault(row.entity_type, {})[name_key(row.parsed_name)] = row.actual_id

        # Load Actual entities
        subjects_rows = await self.db.scalars(select(Subject).where(Subject.is_active.is_(True)))
        self.subjects = {name_key(s.name): s.id for s in subjects_rows}

        teachers_rows = await self.db.scalars(select(Teacher).where(Teacher.is_active.is_(True)))
        self.teachers = {name_key(t.name): t.id for t in teachers_rows}

        groups_rows = await self.db.scalars(select(Group).where(Group.is_active.is_(True)))
        self.groups = {name_key(g.name): g.id for g in groups_rows}

    def _lookup(self, entity_type: str, table: dict, parsed_name: str) -> int | None:
        key = name_key(parsed_name)
        if key in self.aliases.get(entity_type, {}):
            return self.aliases[entity_type][key]
        return table.get(key)

    def normalize_subject(self, parsed_name: str) -> int | None:
        return self._lookup("subject", self.subjects, parsed_name)

    def normalize_teacher(self, parsed_name: str) -> int | None:
        found = self._lookup("teacher", self.teachers, parsed_name)
        if found is not None:
            return found
        # The site sometimes truncates initials ("Миргородський Д."). Accept a
        # prefix match only when it identifies exactly one known teacher.
        key = name_key(parsed_name)
        if len(key) >= 4:
            candidates = {tid for name, tid in self.teachers.items() if name.startswith(key)}
            if len(candidates) == 1:
                return candidates.pop()
        return None

    def normalize_group(self, parsed_name: str) -> int | None:
        return self._lookup("group", self.groups, parsed_name)

    def remember(self, entity_type: str, name: str, entity_id: int) -> None:
        table = {"subject": self.subjects, "teacher": self.teachers, "group": self.groups}[entity_type]
        table[name_key(name)] = entity_id
