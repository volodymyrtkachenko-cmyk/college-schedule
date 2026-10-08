"""Run ONLY against a dedicated test PostgreSQL instance, never production."""
import asyncio
import os
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from fastapi import HTTPException
from app.services.import_lock import import_mutex

@pytest.fixture
def anyio_backend(): return 'asyncio'

@pytest.fixture
async def pg_engine():
    url = os.getenv('TEST_POSTGRES_URL')
    if not url:
        pytest.skip('TEST_POSTGRES_URL is required for real PostgreSQL verification')
    if not url.startswith('postgresql+psycopg://'):
        pytest.fail('Use postgresql+psycopg:// for the isolated test database')
    engine = create_async_engine(url,poolclass=NullPool)
    try:
        yield engine
    finally:
        await engine.dispose()

@pytest.mark.anyio
async def test_second_connection_blocked_across_business_commit(pg_engine):
    async with import_mutex(pg_engine,'integration-1'):
        async with pg_engine.connect() as business:
            await business.execute(text('SELECT 1'))
            await business.commit()
        with pytest.raises(HTTPException) as exc:
            async with import_mutex(pg_engine,'integration-2'):
                pytest.fail('Second import entered')
        assert exc.value.status_code == 409
    async with import_mutex(pg_engine,'integration-3'):
        pass

@pytest.mark.anyio
async def test_body_error_releases_real_lock(pg_engine):
    with pytest.raises(ValueError):
        async with import_mutex(pg_engine,'integration-error'):
            raise ValueError('simulated import failure')
    async with import_mutex(pg_engine,'integration-after-error'):
        pass

@pytest.mark.anyio
async def test_cancelled_import_releases_real_lock(pg_engine):
    ready = asyncio.Event()
    async def run():
        async with import_mutex(pg_engine,'integration-cancel'):
            ready.set()
            await asyncio.Event().wait()
    task = asyncio.create_task(run())
    await asyncio.wait_for(ready.wait(),timeout=10)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    async with import_mutex(pg_engine,'integration-after-cancel'):
        pass
