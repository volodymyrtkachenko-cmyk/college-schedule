"""Transaction locking helpers for schedule versions."""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def lock_versions(db: AsyncSession) -> None:
    """Acquire an advisory transaction lock on PostgreSQL for schedule-version writes."""
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(424243)"))
