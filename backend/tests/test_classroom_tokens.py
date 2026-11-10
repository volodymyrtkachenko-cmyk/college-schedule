import pytest
import os
from unittest.mock import patch
from fastapi import HTTPException
from cryptography.fernet import Fernet
from app.core.crypto import (
    encrypt_token,
    decrypt_token,
    decrypt_token_detailed,
    rotate_token,
    is_fernet_ciphertext,
)
from app.routers.classroom import _sanitize_error_msg, REQUIRED_CLASSROOM_SCOPES
from test_classroom_sync import classroom_db


def test_crypto_multifernet_fallback_and_rotation():
    key_old = Fernet.generate_key().decode()
    key_new = Fernet.generate_key().decode()

    # Encrypt with old key
    plain = "1//mock_refresh_token_abc_123"
    cipher_old = encrypt_token(plain, override_key=key_old)
    assert is_fernet_ciphertext(cipher_old)

    # Decrypt with new key as primary and old key in candidate list
    with patch.dict(os.environ, {"CLASSROOM_FERNET_KEY": key_new, "CLASSROOM_FERNET_OLD_KEYS": key_old}):
        decrypted, status = decrypt_token_detailed(cipher_old)
        assert decrypted == plain
        assert "ok:" in status

        # Rotate should produce a new ciphertext encrypted with key_new
        cipher_rotated = rotate_token(cipher_old)
        assert cipher_rotated is not None
        assert cipher_rotated != cipher_old

        # cipher_rotated should now decrypt directly with key_new (status: ok:key_0)
        dec_rot, status_rot = decrypt_token_detailed(cipher_rotated)
        assert dec_rot == plain
        assert status_rot == "ok:key_0"


@pytest.mark.anyio
async def test_crypto_invalid_tokens():
    # Bad ciphertext
    bad_cipher = "gAAAAABnInvalidCiphertextPaddingTestLength123456789012345678901234567890"
    dec, status = decrypt_token_detailed(bad_cipher)
    assert dec is None
    assert status == "undecryptable"

    # Access token mistakenly saved as refresh token (rejected by refresh handler)
    from app.routers.classroom import _refresh_google_token_detailed
    tok, err, status = await _refresh_google_token_detailed("ya29.a0AfH6SMD_mock_access_token_12345")
    assert tok is None
    assert err == "token_is_access_token_not_refresh_token"


def test_sanitize_error_msg_redaction():
    leak_str = "Error refreshing ya29.testaccess_123 with RT 1//testrefresh_456 and cipher gAAAAABtestcipher_789"
    sanitized = _sanitize_error_msg(leak_str)
    assert "ya29" not in sanitized
    assert "1//" not in sanitized
    assert "gAAAAA" not in sanitized
    assert "[REDACTED_TOKEN]" in sanitized
    assert "[REDACTED_REFRESH_TOKEN]" in sanitized
    assert "[REDACTED_CIPHERTEXT]" in sanitized


def test_required_scopes_present():
    assert "classroom.courses.readonly" in REQUIRED_CLASSROOM_SCOPES


@pytest.mark.anyio
async def test_sync_all_endpoint_requires_auth_or_cron_key(classroom_db):
    client, state = classroom_db
    # 1. Without auth -> 401
    r = await client.post("/api/classroom/sync-all")
    assert r.status_code == 401

    # 2. With valid cron key -> 200
    with patch("app.routers.classroom.settings.IMPORT_CRON_SECRET", "super_secret_cron_123"), \
         patch("app.routers.classroom.sync_all_connected_groups_once", return_value={"checked_groups": 0, "processed": []}):
        r_cron = await client.post("/api/classroom/sync-all", headers={"X-Cron-Key": "super_secret_cron_123"})
        assert r_cron.status_code == 200

    from app.routers.classroom import RECOMMENDED_CLASSROOM_SCOPES
    assert "classroom.student-submissions.me.readonly" in RECOMMENDED_CLASSROOM_SCOPES
    assert "classroom.announcements.readonly" in RECOMMENDED_CLASSROOM_SCOPES
