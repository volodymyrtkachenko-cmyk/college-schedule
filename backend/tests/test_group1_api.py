from unittest.mock import AsyncMock
import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import HTTPException
from app.main import app
from app.database import get_db
from app.core.security import get_current_user, create_refresh_token
from app.models import User
from app.routers import admin_import, auth

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.mark.anyio
@pytest.mark.parametrize('role,expected', [('anonymous',401),('viewer',403),('editor',403),('admin',200)])
async def test_import_authorization(monkeypatch, role, expected):
    service = AsyncMock(return_value={'status':'success'})
    monkeypatch.setattr(admin_import,'execute_import_logic', service)
    async def db_override():
        yield None
    async def user_override():
        return User(id=123, username='test', name='Test', role=role, is_active=True)
    app.dependency_overrides[get_db] = db_override
    if role != 'anonymous':
        app.dependency_overrides[get_current_user] = user_override
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
            response = await client.post('/api/admin/import?internal_cron=true')
        assert response.status_code == expected
        if expected == 200:
            service.assert_awaited_once()
        else:
            service.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_admin_invalid_weeks_does_not_import(monkeypatch):
    service = AsyncMock(); monkeypatch.setattr(admin_import,'execute_import_logic',service)
    async def user_override():
        return User(id=123, username='test', name='Test', role='admin', is_active=True)
    async def db_override(): yield None
    app.dependency_overrides[get_current_user]=user_override
    app.dependency_overrides[get_db]=db_override
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
            for weeks in (0,5):
                response=await client.post(f'/api/admin/import?weeks={weeks}')
                assert response.status_code == 422
        service.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_cron_invalid_key_does_not_import(monkeypatch):
    service = AsyncMock(); monkeypatch.setattr(admin_import,'execute_import_logic',service)
    monkeypatch.setattr(admin_import.settings,'IMPORT_CRON_SECRET','test-only-placeholder')
    async def db_override(): yield None
    app.dependency_overrides[get_db]=db_override
    try:
        async with AsyncClient(transport=ASGITransport(app=app,client=('127.0.0.77',123)),base_url='http://test') as client:
            response=await client.post('/api/admin/import/cron',headers={'X-Cron-Key':'wrong'})
            assert response.status_code == 401
        service.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_logout_db_failure_is_not_success():
    user = User(id=123,username='test',name='Test',role='viewer',session_version=1)
    token = create_refresh_token(user)
    db = AsyncMock()
    db.get_bind = lambda: type('Bind',(),{'dialect':type('Dialect',(),{'name':'postgresql'})()})()
    db.execute.side_effect = RuntimeError('simulated DB error')
    from fastapi import Response
    response = Response()
    with pytest.raises(HTTPException) as exc:
        await auth.logout(response=response,refresh_cookie=token,db=db)
    assert exc.value.status_code == 503
    db.rollback.assert_awaited_once()
    assert 'set-cookie' not in response.headers
