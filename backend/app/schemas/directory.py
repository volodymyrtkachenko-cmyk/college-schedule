"""Pydantic schemas for directory and college relationship atlas endpoints."""
from __future__ import annotations

from pydantic import BaseModel


class AtlasGroupNode(BaseModel):
    id: int
    name: str
    course: int | None = None
    faculty_id: int | None = None
    faculty_name: str | None = None
    curator_id: int | None = None
    lessons_count: int = 0


class AtlasTeacherNode(BaseModel):
    id: int
    name: str
    full_name: str | None = None
    room: str | None = None
    groups_count: int = 0
    subjects_count: int = 0
    lessons_count: int = 0


class AtlasSubjectNode(BaseModel):
    id: int
    name: str
    short_name: str | None = None
    groups_count: int = 0
    teachers_count: int = 0
    lessons_count: int = 0


class AtlasRoomNode(BaseModel):
    id: str
    name: str
    floor: int | None = None
    groups_count: int = 0
    teachers_count: int = 0
    lessons_count: int = 0


class AtlasEdge(BaseModel):
    group_id: int
    teacher_id: int
    second_teacher_id: int | None = None
    subject_id: int
    room: str | None = None
    lessons_count: int
    days: list[int]


class AtlasSummary(BaseModel):
    groups_count: int
    teachers_count: int
    subjects_count: int
    rooms_count: int
    edges_count: int


class AtlasResponse(BaseModel):
    summary: AtlasSummary
    groups: list[AtlasGroupNode]
    teachers: list[AtlasTeacherNode]
    subjects: list[AtlasSubjectNode]
    rooms: list[AtlasRoomNode]
    edges: list[AtlasEdge]
