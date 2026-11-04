"""Symmetric Fernet encryption for Google Classroom refresh tokens."""
import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

LEGACY_DEV_KEY = "college-schedule-local-dev-secret-change-me"
LEGACY_FALLBACK_KEY = "college-schedule-fernet"


def _fernet_from_raw(raw: str) -> Fernet:
    """Safely build a Fernet instance from any string."""
    try:
        return Fernet(raw.encode("utf-8"))
    except Exception:
        digest = hashlib.sha256(raw.encode("utf-8")).digest()
        return Fernet(base64.urlsafe_b64encode(digest))


def get_fernet(override_key: Optional[str] = None) -> Fernet:
    """Return the primary Fernet instance using CLASSROOM_FERNET_KEY (or fallback secret)."""
    raw = (
        override_key
        or os.getenv("CLASSROOM_FERNET_KEY")
        or os.getenv("FERNET_KEY")
        or getattr(settings, "classroom_fernet_key", "")
        or ""
    ).strip()

    if raw:
        return _fernet_from_raw(raw)

    fallback = getattr(settings, "jwt_secret_key", "") or LEGACY_FALLBACK_KEY
    return _fernet_from_raw(fallback)


def get_candidate_fernets(override_key: Optional[str] = None) -> list[Fernet]:
    """
    Return ordered list of Fernet instances to try during decryption.
    Ensures zero downtime / no lost tokens if secrets (e.g. JWT_SECRET_KEY)
    are rotated or migrated from dev to production defaults.
    """
    primary = get_fernet(override_key)
    fernets: list[Fernet] = [primary]
    seen_hashes: set[bytes] = set()

    def _add_raw(raw_key: Optional[str]):
        if not raw_key:
            return
        cleaned = raw_key.strip()
        if not cleaned:
            return
        f = _fernet_from_raw(cleaned)
        h = hashlib.sha256(cleaned.encode("utf-8")).digest()
        if h not in seen_hashes:
            seen_hashes.add(h)
            fernets.append(f)

    raw_primary = (
        override_key
        or os.getenv("CLASSROOM_FERNET_KEY")
        or os.getenv("FERNET_KEY")
        or getattr(settings, "classroom_fernet_key", "")
        or getattr(settings, "jwt_secret_key", "")
        or LEGACY_FALLBACK_KEY
    ).strip()
    seen_hashes.add(hashlib.sha256(raw_primary.encode("utf-8")).digest())

    _add_raw(getattr(settings, "jwt_secret_key", ""))
    _add_raw(os.getenv("JWT_SECRET_KEY", ""))
    _add_raw(os.getenv("CLASSROOM_FERNET_KEY", ""))
    _add_raw(LEGACY_DEV_KEY)
    _add_raw(LEGACY_FALLBACK_KEY)

    return fernets


def is_fernet_ciphertext(value: Optional[str]) -> bool:
    """Check whether a string looks like a Fernet token."""
    if not value:
        return False
    return value.startswith("gAAAAA") and len(value) >= 60


def encrypt_token(plain_token: Optional[str], override_key: Optional[str] = None) -> Optional[str]:
    """Encrypt a plaintext token using Fernet. Returns None if input is empty."""
    if not plain_token:
        return None
    val = plain_token.strip()
    if not val:
        return None
    if is_fernet_ciphertext(val):
        try:
            get_fernet(override_key).decrypt(val.encode("utf-8"))
            return val
        except InvalidToken:
            pass
    return get_fernet(override_key).encrypt(val.encode("utf-8")).decode("utf-8")


def decrypt_token(cipher_or_plain: Optional[str], override_key: Optional[str] = None) -> Optional[str]:
    """Decrypt a Fernet-encrypted token, with safe fallback for legacy plaintext during migration."""
    if not cipher_or_plain:
        return None
    val = cipher_or_plain.strip()
    if not val:
        return None
    if not is_fernet_ciphertext(val):
        return val

    candidates = get_candidate_fernets(override_key)
    for f in candidates:
        try:
            return f.decrypt(val.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            continue
        except Exception:
            continue
    return None
