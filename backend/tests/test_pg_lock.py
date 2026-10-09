import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.services.import_lock import import_mutex

@pytest.fixture
def anyio_backend():
    return 'asyncio'

def resources():
    conn = SimpleNamespace(
        dialect=SimpleNamespace(name='postgresql'),
        scalar=AsyncMock(side_effect=[True, True]),
        begin=AsyncMock(return_value=SimpleNamespace(rollback=AsyncMock())),
        rollback=AsyncMock(), invalidate=AsyncMock(), close=AsyncMock(),
    )
    engine = SimpleNamespace(connect=AsyncMock(return_value=conn))
    return engine, conn

@pytest.mark.anyio
async def test_success():
    engine, conn = resources()
    async with import_mutex(engine, 'test'):
        pass
    assert conn.scalar.await_count == 1
    conn.close.assert_awaited_once()
    conn.invalidate.assert_not_awaited()

@pytest.mark.anyio
async def test_busy():
    engine, conn = resources(); conn.scalar.side_effect = [False]
    with pytest.raises(HTTPException) as exc:
        async with import_mutex(engine, 'test'):
            pytest.fail('Must not run')
    assert exc.value.status_code == 409
    assert conn.scalar.await_count == 1
    conn.close.assert_awaited_once()

@pytest.mark.anyio
async def test_unknown_acquire_invalidates():
    engine, conn = resources(); conn.scalar.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        async with import_mutex(engine, 'test'):
            pass
    conn.invalidate.assert_awaited_once()
    conn.close.assert_awaited_once()

@pytest.mark.anyio
async def test_body_cancellation_releases_lock():
    engine, conn = resources()
    with pytest.raises(asyncio.CancelledError):
        async with import_mutex(engine, 'test'):
            raise asyncio.CancelledError()
    assert conn.scalar.await_count == 1
    conn.close.assert_awaited_once()

@pytest.mark.anyio
async def test_real_task_cancel_during_unlock_waits_for_cleanup():
    engine, conn = resources()
    started, finish = asyncio.Event(), asyncio.Event()
    events = []
    async def rollback():
        events.append('unlock-start'); started.set()
        await finish.wait(); events.append('unlock-end')
    async def close():
        events.append('close')
    conn.rollback.side_effect = rollback; conn.close.side_effect = close
    async def run():
        async with import_mutex(engine, 'test'):
            return 'success'
    task = asyncio.create_task(run())
    await started.wait(); task.cancel(); await asyncio.sleep(0)
    task.cancel(); await asyncio.sleep(0)
    assert not task.done()
    assert 'close' not in events
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert events == ['unlock-start', 'unlock-end', 'close']

@pytest.mark.anyio
async def test_unlock_failure_invalidates_and_closes():
    engine, conn = resources()
    conn.rollback.side_effect = RuntimeError('unlock failed')
    with pytest.raises(RuntimeError, match='unlock failed'):
        async with import_mutex(engine, 'test'):
            pass
    conn.invalidate.assert_awaited_once(); conn.close.assert_awaited_once()

@pytest.mark.anyio
async def test_cleanup_does_not_mask_body_error():
    engine, conn = resources()
    conn.rollback.side_effect = RuntimeError('unlock failed')
    with pytest.raises(ValueError, match='primary'):
        async with import_mutex(engine, 'test'):
            raise ValueError('primary')
    conn.invalidate.assert_awaited_once(); conn.close.assert_awaited_once()
