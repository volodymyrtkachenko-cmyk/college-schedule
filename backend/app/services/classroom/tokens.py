import os
import re
from datetime import datetime, timedelta
from typing import Optional

import httpx
from cryptography.fernet import Fernet

from app.config import settings
from app.core.crypto import (
    decrypt_token as _core_decrypt_token,
    decrypt_token_detailed as _core_decrypt_token_detailed,
    encrypt_token as _core_encrypt_token,
    get_candidate_fernets,
    get_encryption_key_source,
    has_primary_encryption_key,
    rotate_token as _core_rotate_token,
)
from app.models import ClassroomCredential

DEFAULT_GOOGLE_CLIENT_ID = "1079868158360-ok75uv5l93pcql2iktfcple97sdu180b.apps.googleusercontent.com"

REQUIRED_CLASSROOM_SCOPES = [
    "classroom.courses.readonly",
]
RECOMMENDED_CLASSROOM_SCOPES = [
    "classroom.coursework.me.readonly",
    "classroom.student-submissions.me.readonly",
    "classroom.announcements.readonly",
]


def _get_stable_fernet_keys() -> list[Fernet]:
    """Делегує список Fernet-ключів у єдине джерело правди `app.core.crypto`."""
    return get_candidate_fernets()


def encrypt_token(token: Optional[str]) -> str:
    return _core_encrypt_token(token) or ""


def decrypt_token(token_enc: Optional[str]) -> str:
    return _core_decrypt_token(token_enc) or ""


def decrypt_token_detailed(token_enc: Optional[str]) -> tuple[Optional[str], str]:
    return _core_decrypt_token_detailed(token_enc)


def rotate_token(token_enc: Optional[str]) -> Optional[str]:
    return _core_rotate_token(token_enc)


def get_google_client_id() -> str:
    return (settings.google_client_id or "").strip() or DEFAULT_GOOGLE_CLIENT_ID


def get_google_client_secret() -> str:
    return (settings.google_client_secret or "").strip()


def _sanitize_error_msg(msg: str) -> str:
    """Ensure no tokens or secrets leak into logs or DB error strings."""
    if not msg:
        return ""
    cleaned = re.sub(r"ya29\.[A-Za-z0-9_\-\.]+", "[REDACTED_TOKEN]", msg)
    cleaned = re.sub(r"1//[A-Za-z0-9_\-\.]+", "[REDACTED_REFRESH_TOKEN]", cleaned)
    cleaned = re.sub(r"gAAAAA[A-Za-z0-9_\-=]+", "[REDACTED_CIPHERTEXT]", cleaned)
    return cleaned[:400]


async def _refresh_google_token_detailed(refresh_token: str) -> tuple[Optional[str], Optional[str], Optional[int]]:
    """Returns (access_token, error_code_or_msg, status_code)."""
    plain_rt, decrypt_status = decrypt_token_detailed(refresh_token)
    if not plain_rt:
        return None, f"missing_or_corrupt_refresh_token:{decrypt_status}", 400
    if plain_rt.startswith("ya29."):
        return None, "token_is_access_token_not_refresh_token", 400
    client_id = get_google_client_id()
    if not client_id:
        return None, "missing_client_id", 400
    client_secret = get_google_client_secret()
    if not client_secret:
        return None, "missing_client_secret", 400
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": plain_rt,
                    "grant_type": "refresh_token",
                },
            )
            if resp.status_code == 200:
                return resp.json().get("access_token"), None, 200
            try:
                err_data = resp.json()
                err_code = err_data.get("error") or f"http_{resp.status_code}"
                err_desc = err_data.get("error_description") or ""
                if err_code == "invalid_grant":
                    return None, f"invalid_grant: {_sanitize_error_msg(err_desc)}".strip(": "), resp.status_code
                return None, _sanitize_error_msg(f"{err_code}: {err_desc}".strip(": ")), resp.status_code
            except Exception:
                return None, f"http_{resp.status_code}", resp.status_code
    except Exception as exc:
        return None, _sanitize_error_msg(str(exc)), 500


async def _refresh_google_token(refresh_token: str) -> Optional[str]:
    tok, _, _ = await _refresh_google_token_detailed(refresh_token)
    return tok


def _is_permanent_token_error(err_msg: Optional[str]) -> bool:
    """True коли токен відкликаний або пошкоджений назавжди і потрібна повторна прив'язка."""
    msg = (err_msg or "").lower()
    if not msg:
        return False
    return (
        "invalid_grant" in msg
        or "missing_or_corrupt_refresh_token" in msg
        or "token_is_access_token_not_refresh_token" in msg
        or "unauthorized_client" in msg
    )


def classify_relink_reason_code(
    err_msg: Optional[str],
    has_refresh_token: bool = True,
    token_status: Optional[str] = None,
) -> str:
    """Map stored token/API errors onto stable frontend relink reason codes."""
    msg = (err_msg or "").lower()
    t_status = (token_status or "").lower()
    if t_status == "undecryptable" or "undecryptable" in msg or "fernet" in msg:
        return "key_changed"
    if (
        not has_refresh_token
        or t_status == "empty"
        or "no_refresh_token" in msg
        or "missing_or_corrupt_refresh_token:empty" in msg
        or "token_is_access_token_not_refresh_token" in msg
    ):
        return "no_refresh_token"
    if "courses_error_403" in msg or "courses_http_403" in msg or "scope" in msg:
        return "missing_scopes"
    if (
        "invalid_grant" in msg
        or "unauthorized_client" in msg
        or "revoked" in msg
        or "courses_error_401" in msg
        or "courses_http_401" in msg
    ):
        return "revoked"
    if "missing_or_corrupt_refresh_token" in msg:
        return "key_changed"
    return "token_refresh_failed"


def _is_permanent_courses_error(status_code: int, response_text: str = "") -> bool:
    """Відокремлює відкликаний доступ (401/403 scope) від тимчасових лімітів/збоїв Google API (429/5xx)."""
    if status_code == 401:
        return True
    if status_code == 403:
        low = (response_text or "").lower()
        transient_markers = ("ratelimit", "rate_limit", "quota", "limitexceeded", "backend", "unavailable")
        return not any(marker in low for marker in transient_markers)
    return False


def _is_transient_recoverable_error(last_error: Optional[str]) -> bool:
    """True для записів, помилково деактивованих через тимчасову помилку (429/5xx/missing_client_secret)."""
    msg = (last_error or "").lower()
    if not msg or _is_permanent_token_error(msg):
        return False
    return (
        "missing_client_secret" in msg
        or "courses_error_429" in msg
        or "courses_error_5" in msg
        or "courses_http_429" in msg
        or "courses_http_5" in msg
        or "network_error" in msg
        or "timeout" in msg
        or "rate_limit" in msg
    )


def _apply_credential_backoff(cred: ClassroomCredential, err_msg: str, now: datetime) -> None:
    cred.fail_count = (cred.fail_count or 0) + 1
    delay_seconds = min(14400.0, 900.0 * (2 ** min(cred.fail_count, 4)))
    cred.next_attempt_at = now + timedelta(seconds=delay_seconds)
    cred.last_error = _sanitize_error_msg(err_msg)


def _clear_credential_errors(
    cred: ClassroomCredential,
    now: Optional[datetime] = None,
    *,
    refreshed: bool = False,
) -> None:
    """Скидає старі помилки й backoff після успішного оновлення токена або запиту."""
    if refreshed and now is not None:
        cred.last_refresh_ok_at = now
    cred.fail_count = 0
    cred.next_attempt_at = None
    cred.last_error = None
    cred.needs_relink = False
    cred.is_active = True
