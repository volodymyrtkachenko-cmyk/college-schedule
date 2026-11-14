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
         patch("app.services.classroom.worker.sync_all_connected_groups_once", return_value={"checked_groups": 0, "processed": []}):
        r_cron = await client.post("/api/classroom/sync-all", headers={"X-Cron-Key": "super_secret_cron_123"})
        assert r_cron.status_code == 200

    from app.routers.classroom import RECOMMENDED_CLASSROOM_SCOPES
    assert "classroom.student-submissions.me.readonly" in RECOMMENDED_CLASSROOM_SCOPES
    assert "classroom.announcements.readonly" in RECOMMENDED_CLASSROOM_SCOPES


def test_stable_fernet_keys_and_plaintext_handling():
    from app.routers.classroom import encrypt_token, decrypt_token, _get_stable_fernet_keys
    from datetime import datetime, timezone, timedelta
    from app.models import ClassroomCredential
    from app.routers.classroom import _build_group_accounts_summary

    # Plaintext 1// and ya29 tokens passthrough
    assert decrypt_token("1//plain_refresh_token_test") == "1//plain_refresh_token_test"
    assert decrypt_token("ya29.plain_access_token_test") == "ya29.plain_access_token_test"

    # Encrypt and decrypt with default stable key
    token = "1//my_permanent_refresh_token"
    enc = encrypt_token(token)
    assert enc != token
    assert decrypt_token(enc) == token

    # Check that stable keys are generated
    keys = _get_stable_fernet_keys()
    assert len(keys) >= 1


@pytest.mark.anyio
async def test_is_cred_healthy_logic(classroom_db):
    from datetime import datetime, timezone, timedelta
    from app.models import ClassroomCredential
    from app.routers.classroom import _build_group_accounts_summary, encrypt_token

    client, state = classroom_db
    now_utc = datetime.now(timezone.utc)
    gid = state["group_id"]

    # 1. Credential with valid refresh_token 1//... -> healthy
    c1 = ClassroomCredential(
        id=101,
        group_id=gid,
        google_user_id="user_101",
        email="student1@kre.dp.ua",
        refresh_token=encrypt_token("1//valid_google_refresh_token_123"),
        last_synced_at=now_utc - timedelta(hours=2),
        is_active=False,
    )
    # 2. Credential with recent sync (< 55 min) even without valid refresh_token -> healthy
    c2 = ClassroomCredential(
        id=102,
        group_id=gid,
        google_user_id="user_102",
        email="student2@kre.dp.ua",
        refresh_token="",
        last_synced_at=now_utc - timedelta(minutes=20),
        is_active=False,
    )
    # 3. Credential with invalid_grant error -> unhealthy
    c3 = ClassroomCredential(
        id=103,
        group_id=gid,
        google_user_id="user_103",
        email="student3@kre.dp.ua",
        refresh_token=encrypt_token("1//revoked_token_123"),
        last_error="invalid_grant: Token has been expired or revoked.",
        last_synced_at=now_utc - timedelta(hours=5),
        is_active=True,
    )

    async with state["sessions"]() as db:
        db.add_all([c1, c2, c3])
        await db.commit()
        summary = await _build_group_accounts_summary(db, gid)
    # c1 and c2 should be active (healthy), c3 should be inactive (unhealthy)
    accs = {a["id"]: a for a in summary["accounts"]}
    assert accs[101]["is_active"] is True
    assert accs[102]["is_active"] is True
    assert accs[103]["is_active"] is False
    assert summary["connected_accounts_count"] == 2
    assert summary["needs_reconnect"] is False


@pytest.mark.anyio
async def test_honest_group_accounts_summary_preserves_errors_backoff_and_needs_relink(classroom_db):
    from datetime import datetime, timedelta, timezone
    from app.models import ClassroomCredential
    from app.routers.classroom import _build_group_accounts_summary

    _, state = classroom_db
    gid = state["group_id"]
    now_utc = datetime.now(timezone.utc)
    valid_enc = encrypt_token("1//honest_refresh_token")

    c1 = ClassroomCredential(
        id=201,
        group_id=gid,
        google_user_id="uid_honest_1",
        email="ok@kre.dp.ua",
        refresh_token=valid_enc,
        last_synced_at=now_utc - timedelta(minutes=10),
        is_active=True,
        needs_relink=False,
    )
    c2 = ClassroomCredential(
        id=202,
        group_id=gid,
        google_user_id="uid_honest_2",
        email="backoff@kre.dp.ua",
        refresh_token=valid_enc,
        last_synced_at=now_utc - timedelta(hours=3),
        last_error="courses_http_429",
        fail_count=2,
        next_attempt_at=now_utc + timedelta(minutes=25),
        is_active=True,
        needs_relink=False,
    )
    c3 = ClassroomCredential(
        id=203,
        group_id=gid,
        google_user_id="uid_honest_3",
        email="relink@kre.dp.ua",
        refresh_token=valid_enc,
        last_synced_at=now_utc - timedelta(hours=18),
        last_error="needs_relink: courses_error_401",
        fail_count=1,
        is_active=False,
        needs_relink=True,
    )
    c4 = ClassroomCredential(
        id=204,
        group_id=gid,
        google_user_id="uid_honest_4",
        email="corrupt@kre.dp.ua",
        refresh_token="",
        last_synced_at=now_utc - timedelta(minutes=15),
        last_error="missing_or_corrupt_refresh_token",
        fail_count=1,
        is_active=False,
        needs_relink=True,
    )

    async with state["sessions"]() as db:
        db.add_all([c1, c2, c3, c4])
        await db.commit()
        summary = await _build_group_accounts_summary(db, gid)

    accs = {a["id"]: a for a in summary["accounts"]}
    assert accs[201]["is_active"] is True
    assert accs[201]["last_error"] is None

    # c2 має бути здоровим за токеном, але НЕ приховувати помилку й next_attempt_at!
    assert accs[202]["is_active"] is True
    assert accs[202]["last_error"] == "courses_http_429"
    assert accs[202]["fail_count"] == 2
    assert accs[202]["next_attempt_at"] is not None

    # c3 і c4 мають бути нездоровими через needs_relink / missing_or_corrupt_refresh_token
    assert accs[203]["is_active"] is False
    assert accs[203]["needs_relink"] is True
    assert accs[204]["is_active"] is False
    assert accs[204]["needs_relink"] is True
    assert summary["connected_accounts_count"] == 2


def test_classroom_tokens_aligns_with_crypto_primary_and_legacy_fallback():
    from app.services.classroom import tokens as classroom_tokens

    key_primary = Fernet.generate_key().decode()
    fallback_secret = "google-client-secret-for-legacy-encrypt"
    plain_rt = "1//sync_aligned_rt_token_999"

    with patch.dict(
        os.environ,
        {"GOOGLE_CLIENT_SECRET": fallback_secret},
        clear=False,
    ):
        os.environ.pop("ENCRYPTION_KEY", None)
        os.environ.pop("CLASSROOM_FERNET_KEY", None)
        os.environ.pop("FERNET_KEY", None)
        assert classroom_tokens.has_primary_encryption_key() is False
        assert classroom_tokens.get_encryption_key_source() == "GOOGLE_CLIENT_SECRET"
        legacy_cipher = classroom_tokens.encrypt_token(plain_rt)

    with patch.dict(
        os.environ,
        {"CLASSROOM_FERNET_KEY": key_primary, "GOOGLE_CLIENT_SECRET": fallback_secret},
        clear=False,
    ):
        assert classroom_tokens.has_primary_encryption_key() is True
        assert classroom_tokens.get_encryption_key_source() == "CLASSROOM_FERNET_KEY"

        # Old cipher still decrypts via aligned candidate list
        dec_old, status_old = classroom_tokens.decrypt_token_detailed(legacy_cipher)
        assert dec_old == plain_rt
        assert status_old.startswith("ok:key_")

        # Rotating upgrades it to key_0 and core.crypto agrees identically
        rotated = classroom_tokens.rotate_token(legacy_cipher)
        assert rotated is not None
        assert classroom_tokens.decrypt_token_detailed(rotated) == (plain_rt, "ok:key_0")
        assert decrypt_token_detailed(rotated) == (plain_rt, "ok:key_0")


def test_configure_app_logging_enables_info_level_without_breaking_root_handlers():
    import logging
    from app.main import _configure_app_logging

    app_logger = logging.getLogger("app")
    prev_level = app_logger.level
    try:
        app_logger.setLevel(logging.WARNING)
        _configure_app_logging()
        assert app_logger.level == logging.INFO
        assert logging.getLogger("app.services.classroom.worker").getEffectiveLevel() == logging.INFO
    finally:
        app_logger.setLevel(prev_level)


@pytest.mark.anyio
async def test_credentials_diagnostics_endpoint_permissions_and_summary(classroom_db):
    from datetime import datetime, timedelta, timezone
    from app.core.security import create_access_token, hash_password
    from app.models import ClassroomCredential, User
    from app.services.classroom import tokens as classroom_tokens

    client, state = classroom_db
    gid = state["group_id"]
    now_utc = datetime.now(timezone.utc)

    # 1. Unauthenticated -> 401
    unauth = await client.get("/api/classroom/credentials/diagnostics")
    assert unauth.status_code == 401

    async with state["sessions"]() as db:
        admin = User(
            username="admin_diag",
            name="Admin Diag",
            password_hash=hash_password("pass1234"),
            role="admin",
        )
        viewer = User(
            username="viewer_diag",
            name="Viewer Diag",
            password_hash=hash_password("pass1234"),
            role="viewer",
        )
        db.add_all([admin, viewer])
        await db.commit()
        await db.refresh(admin)
        await db.refresh(viewer)
        admin_headers = {"Authorization": f"Bearer {create_access_token(admin)}"}
        viewer_headers = {"Authorization": f"Bearer {create_access_token(viewer)}"}

        c_ok = ClassroomCredential(
            group_id=gid,
            google_user_id="diag_ok",
            email="ok_diag@kre.dp.ua",
            student_name="Healthy User",
            refresh_token=classroom_tokens.encrypt_token("1//diag_healthy_rt_secret"),
            is_active=True,
            needs_relink=False,
            last_synced_at=now_utc - timedelta(minutes=5),
        )
        c_bad = ClassroomCredential(
            group_id=gid,
            google_user_id="diag_bad",
            email="bad_diag@kre.dp.ua",
            student_name="Corrupt User",
            refresh_token="gAAAAABnInvalidCiphertextPaddingTestLength123456789012345678901234567890",
            is_active=False,
            needs_relink=True,
            fail_count=2,
            last_error="missing_or_corrupt_refresh_token:undecryptable",
            next_attempt_at=now_utc + timedelta(minutes=30),
        )
        db.add_all([c_ok, c_bad])
        await db.commit()

    # 2. Viewer -> 403
    forbidden = await client.get("/api/classroom/credentials/diagnostics", headers=viewer_headers)
    assert forbidden.status_code == 403

    # 3. Admin -> 200 with structured status, no secret/prefix leaks
    resp = await client.get("/api/classroom/credentials/diagnostics", headers=admin_headers)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["total_credentials"] == 2
    assert payload["active_credentials"] == 1
    assert payload["needs_relink_credentials"] == 1
    assert "encryption_key_source" in payload
    assert payload["error_summary"]["by_token_status"]["ok"] == 1
    assert payload["error_summary"]["by_token_status"]["undecryptable"] == 1
    assert payload["error_summary"]["by_reason_code"]["key_changed"] == 1
    assert payload["error_summary"]["in_backoff_count"] == 1
    assert payload["error_summary"]["inactive_count"] == 1

    by_uid = {c["google_user_id"]: c for c in payload["credentials"]}
    assert by_uid["diag_ok"]["token_status"] == "ok:key_0"
    assert by_uid["diag_ok"]["token_format_valid"] is True
    assert by_uid["diag_ok"]["group_name"]
    assert "token_prefix" not in by_uid["diag_ok"]
    assert "1//diag" not in str(payload)

    assert by_uid["diag_bad"]["token_status"] == "undecryptable"
    assert by_uid["diag_bad"]["token_format_valid"] is False
    assert by_uid["diag_bad"]["reason_code"] == "key_changed"
    assert by_uid["diag_bad"]["last_error"] == "missing_or_corrupt_refresh_token:undecryptable"
