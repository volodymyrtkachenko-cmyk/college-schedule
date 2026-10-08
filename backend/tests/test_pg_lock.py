import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
import asyncio

from app.routers.admin_import import execute_import_logic

@pytest.mark.anyio
async def test_execute_import_logic_pg_lock():
    mock_db = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.dialect.name = "postgresql"
    
    # Setup the mock engine to return our mock_conn
    mock_engine = MagicMock()
    mock_context = AsyncMock()
    mock_context.__aenter__.return_value = mock_conn
    mock_engine.connect.return_value = mock_context
    
    # We will test two scenarios:
    # 1. Lock acquired successfully, _do_import works, lock released
    # 2. Lock acquired, task cancelled, lock still released (shielded)
    
    with patch("app.routers.admin_import.engine", mock_engine), \
         patch("app.routers.admin_import._do_import", new_callable=AsyncMock) as mock_do_import:
         
        mock_conn.scalar.return_value = True # Lock acquired
        
        # Test 1: Normal success
        await execute_import_logic(mock_db, 2)
        
        mock_conn.scalar.assert_called_once()
        mock_do_import.assert_called_once()
        mock_conn.execute.assert_called_once() # Unlock called
        mock_conn.commit.assert_called_once()
        
        # Test 2: Task cancelled during _do_import
        mock_conn.reset_mock()
        mock_do_import.reset_mock()
        mock_conn.scalar.return_value = True # Lock acquired
        
        mock_do_import.side_effect = asyncio.CancelledError("Cancelled")
        
        with pytest.raises(asyncio.CancelledError):
            await execute_import_logic(mock_db, 2)
            
        mock_conn.scalar.assert_called_once()
        mock_do_import.assert_called_once()
        # Ensure unlock still called
        mock_conn.execute.assert_called_once()
        mock_conn.commit.assert_called_once()
        
        # Test 3: Lock unavailable
        mock_conn.reset_mock()
        mock_do_import.reset_mock()
        mock_conn.scalar.return_value = False # Lock unavailable
        
        with pytest.raises(HTTPException) as exc:
            await execute_import_logic(mock_db, 2)
        assert exc.value.status_code == 409
        
        mock_conn.scalar.assert_called_once()
        mock_do_import.assert_not_called()
        # Unlock NOT called
        mock_conn.execute.assert_not_called()
