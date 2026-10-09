"""Import mutex; session-level PostgreSQL lock on a dedicated connection."""
import asyncio
import logging
from contextlib import asynccontextmanager
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncConnection
from fastapi import HTTPException

logger = logging.getLogger(__name__)
IMPORT_LOCK_KEY = 424242
CLEANUP_SQL_TIMEOUT = 10
_local_lock = asyncio.Lock()  # Development SQLite only, not a distributed lock.

async def _finish_connection(conn: AsyncConnection, acquired: bool,
                             uncertain: bool, error_id: str) -> None:
    try:
        if uncertain:
            await conn.invalidate()
        elif acquired:
            try:
                async with asyncio.timeout(CLEANUP_SQL_TIMEOUT):
                    await conn.rollback()
            except BaseException:
                # Do not put a possibly locked physical session back into the pool.
                await conn.invalidate()
                raise
    finally:
        await conn.close()

async def _wait_for_cleanup(task: asyncio.Task) -> None:
    """Wait until cleanup stops using the connection, then propagate cancellation."""
    cancellation = None
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError as exc:
            cancellation = exc
        except Exception:
            break
    # Retrieve the result even when cancelled so no detached exception remains.
    try:
        task.result()
    except BaseException:
        if cancellation is not None:
            raise cancellation
        raise
    if cancellation is not None:
        raise cancellation

@asynccontextmanager
async def import_mutex(engine: AsyncEngine, error_id: str):
    conn = await engine.connect()
    acquired = False
    uncertain = False
    primary_error = None
    local_acquired = False
    try:
        if conn.dialect.name == "postgresql":
            # Cancellation during acquire can leave the result unknown.
            uncertain = True
            trans = await conn.begin()
            acquired = bool(await conn.scalar(
                text("SELECT pg_try_advisory_xact_lock(:key)"),
                {"key": IMPORT_LOCK_KEY},
            ))
            uncertain = False
            if not acquired:
                await trans.rollback()
                raise HTTPException(409, "Імпорт вже виконується іншим процесом")
            # Keep transaction open to retain the physical connection (PgBouncer compatibility)
            # xact_lock will be automatically released when conn is closed/rolled back in finally block.
        else:
            if _local_lock.locked():
                raise HTTPException(409, "Імпорт вже виконується")
            await _local_lock.acquire()
            local_acquired = True
        yield
    except BaseException as exc:
        primary_error = exc
        raise
    finally:
        task = asyncio.create_task(
            _finish_connection(conn, acquired, uncertain, error_id)
        )
        try:
            await _wait_for_cleanup(task)
        except asyncio.CancelledError:
            if primary_error is None:
                raise
            # The original exception (including cancellation) is already propagating.
            logger.warning("Import cleanup cancelled [%s]", error_id)
        except Exception:
            logger.exception("Import cleanup failed [%s]", error_id)
            if primary_error is None:
                raise
        finally:
            if local_acquired:
                _local_lock.release()
