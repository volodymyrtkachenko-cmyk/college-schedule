"""Pydantic schemas for admin schedule import and migration endpoints."""

from pydantic import BaseModel


class PermanentSyncRequest(BaseModel):
    version_id: int = 1
    lessons: list[dict]


class MigrateRequest(BaseModel):
    neon_url: str
    wipe_supabase: bool = True
