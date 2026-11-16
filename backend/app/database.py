import os
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("sqlite://") and "+aiosqlite" not in url:
        return url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    return url


def build_postgres_engine_kwargs(db_url: str) -> dict:
    """Keep per-dyno pool modest so web + worker + release fit inside Supabase session limits."""
    connect_args: dict = {
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
    }
    # PgBouncer transaction pooler (port 6543) requires disabling psycopg3 prepared statements
    if ":6543" in db_url:
        connect_args["prepare_threshold"] = None

    return {
        "pool_pre_ping": True,
        "pool_size": max(1, int(os.environ.get("DB_POOL_SIZE", "3"))),
        "max_overflow": max(0, int(os.environ.get("DB_MAX_OVERFLOW", "4"))),
        "pool_timeout": 15,
        "pool_recycle": 180,
        "connect_args": connect_args,
    }


class Base(DeclarativeBase):
    pass

# Setup engine with explicit pool params (for PostgreSQL)
_db_url = normalize_database_url(settings.database_url)
_engine_kwargs: dict = {"pool_pre_ping": True}
if "postgresql" in _db_url:
    _engine_kwargs = build_postgres_engine_kwargs(_db_url)

engine: AsyncEngine = create_async_engine(_db_url, **_engine_kwargs)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
