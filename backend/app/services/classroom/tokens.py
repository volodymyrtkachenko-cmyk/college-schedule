import base64
import hashlib
import os
import re
from datetime import datetime, timedelta
from typing import Optional

import httpx
from cryptography.fernet import Fernet

from app.config import settings
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
    """Возвращает список ключей Fernet (основной + резервные), которые не сбрасываются при рестарте сервера."""
    raw_seeds = [
        os.getenv("ENCRYPTION_KEY"),
        os.getenv("SECRET_KEY"),
        os.getenv("GOOGLE_CLIENT_SECRET"),
        os.getenv("DATABASE_URL"),
        "dfkr-college-schedule-persistent-key-2026",
        os.getenv("CLASSROOM_FERNET_KEY"),
        os.getenv("FERNET_KEY"),
        getattr(settings, "classroom_fernet_key", None),
        getattr(settings, "jwt_secret_key", None),
        "college-schedule-local-dev-secret-change-me",
        "college-schedule-fernet",
    ]
    old_keys_str = (
        os.getenv("CLASSROOM_FERNET_OLD_KEYS")
        or getattr(settings, "classroom_fernet_old_keys", "")
        or ""
    ).strip()
    if old_keys_str:
        for k in old_keys_str.split(","):
            raw_seeds.append(k.strip())

    fernets: list[Fernet] = []
    seen: set[bytes] = set()
    for seed in raw_seeds:
        if not seed:
            continue
        try:
            f_direct = Fernet(seed.encode("utf-8"))
            h_direct = hashlib.sha256(seed.encode("utf-8")).digest()
            if h_direct not in seen:
                seen.add(h_direct)
                fernets.append(f_direct)
        except Exception:
            pass
        digest = hashlib.sha256(seed.strip().encode("utf-8")).digest()
        fkey = base64.urlsafe_b64encode(digest)
        if fkey not in seen:
            seen.add(fkey)
            fernets.append(Fernet(fkey))
    return fernets


def encrypt_token(token: Optional[str]) -> str:
    if not token:
        return ""
    clean = token.strip()
    if not clean:
        return ""
    # Используем стабильный ключ от GOOGLE_CLIENT_SECRET / DATABASE_URL, если ENCRYPTION_KEY не задан
    stable_seed = (
        os.getenv("ENCRYPTION_KEY")
        or os.getenv("GOOGLE_CLIENT_SECRET")
        or os.getenv("DATABASE_URL")
        or "dfkr-college-schedule-persistent-key-2026"
    )
    fkey = base64.urlsafe_b64encode(hashlib.sha256(stable_seed.strip().encode("utf-8")).digest())
    return Fernet(fkey).encrypt(clean.encode("utf-8")).decode("utf-8")


def decrypt_token(token_enc: Optional[str]) -> str:
    if not token_enc:
        return ""
    clean = token_enc.strip()
    if not clean:
        return ""
    # Если в БД уже лежит открытый Google refresh_token (1//...) или access_token (ya29.)
    if clean.startswith("1//") or clean.startswith("ya29."):
        return clean
    for f in _get_stable_fernet_keys():
        try:
            return f.decrypt(clean.encode("utf-8")).decode("utf-8")
        except Exception:
            continue
    return ""


def decrypt_token_detailed(token_enc: Optional[str]) -> tuple[Optional[str], str]:
    if not token_enc:
        return None, "empty"
    clean = token_enc.strip()
    if not clean:
        return None, "empty"
    if clean.startswith("1//") or clean.startswith("ya29."):
        return clean, "plaintext"
    for idx, f in enumerate(_get_stable_fernet_keys()):
        try:
            return f.decrypt(clean.encode("utf-8")).decode("utf-8"), f"ok:key_{idx}"
        except Exception:
            continue
    return None, "undecryptable"


def rotate_token(token_enc: Optional[str]) -> Optional[str]:
    if not token_enc:
        return None
    plain = decrypt_token(token_enc)
    if not plain:
        return None
    return encrypt_token(plain)


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
