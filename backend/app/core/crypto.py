"""Symmetric Fernet encryption for Google Classroom refresh tokens with MultiFernet rotation."""
import base64
import hashlib
import logging
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import settings

logger = logging.getLogger(__name__)

LEGACY_DEV_KEY = "college-schedule-local-dev-secret-change-me"
LEGACY_FALLBACK_KEY = "college-schedule-fernet"


def _fernet_from_raw(raw: str) -> Fernet:
    """Safely build a Fernet instance from any string."""
    try:
        return Fernet(raw.encode("utf-8"))
    except Exception:
        digest = hashlib.sha256(raw.encode("utf-8")).digest()
        return Fernet(base64.urlsafe_b64encode(digest))


def get_primary_raw_key(override_key: Optional[str] = None) -> str:
    """Return the raw string for the primary encryption key."""
    raw = (
        override_key
        or os.getenv("ENCRYPTION_KEY")
        or os.getenv("CLASSROOM_FERNET_KEY")
        or os.getenv("FERNET_KEY")
        or getattr(settings, "classroom_fernet_key", "")
        or os.getenv("GOOGLE_CLIENT_SECRET")
        or os.getenv("DATABASE_URL")
        or "dfkr-college-schedule-persistent-key-2026"
    ).strip()
    if raw:
        return raw
    return (getattr(settings, "jwt_secret_key", "") or LEGACY_FALLBACK_KEY).strip()


def get_fernet(override_key: Optional[str] = None) -> Fernet:
    """Return the primary Fernet instance using CLASSROOM_FERNET_KEY (or fallback secret)."""
    return _fernet_from_raw(get_primary_raw_key(override_key))


def get_candidate_fernets(override_key: Optional[str] = None) -> list[Fernet]:
    """
    Return ordered list of Fernet instances to try during decryption.
    Primary key is always index 0. Subsequent keys include historical keys.
    """
    primary = get_fernet(override_key)
    fernets: list[Fernet] = [primary]
    seen_hashes: set[bytes] = set()

    raw_primary = get_primary_raw_key(override_key)
    seen_hashes.add(hashlib.sha256(raw_primary.encode("utf-8")).digest())

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

    # 0. Persistent fallback seeds
    _add_raw(os.getenv("ENCRYPTION_KEY"))
    _add_raw(os.getenv("SECRET_KEY"))
    _add_raw(os.getenv("GOOGLE_CLIENT_SECRET"))
    _add_raw(os.getenv("DATABASE_URL"))
    _add_raw("dfkr-college-schedule-persistent-key-2026")

    # 1. Configured old keys (comma-separated)
    old_keys_str = (
        os.getenv("CLASSROOM_FERNET_OLD_KEYS")
        or getattr(settings, "classroom_fernet_old_keys", "")
        or ""
    ).strip()
    if old_keys_str:
        for k in old_keys_str.split(","):
            _add_raw(k)

    # 2. JWT-derived keys (fallback during migration away from JWT secret)
    _add_raw(getattr(settings, "jwt_secret_key", ""))
    _add_raw(os.getenv("JWT_SECRET_KEY", ""))

    # 3. Environment or config fallbacks
    _add_raw(os.getenv("CLASSROOM_FERNET_KEY", ""))
    _add_raw(getattr(settings, "classroom_fernet_key", ""))
    _add_raw(LEGACY_DEV_KEY)
    _add_raw(LEGACY_FALLBACK_KEY)

    return fernets


def get_multi_fernet(override_key: Optional[str] = None) -> MultiFernet:
    """Return a MultiFernet instance containing primary and all candidate legacy keys."""
    return MultiFernet(get_candidate_fernets(override_key))


def is_fernet_ciphertext(value: Optional[str]) -> bool:
    """Check whether a string looks like a Fernet token."""
    if not value:
        return False
    return value.startswith("gAAAAA") and len(value) >= 60


def encrypt_token(plain_token: Optional[str], override_key: Optional[str] = None) -> Optional[str]:
    """Encrypt a plaintext token using primary Fernet. Returns None if input is empty."""
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
    return get_multi_fernet(override_key).encrypt(val.encode("utf-8")).decode("utf-8")


def rotate_token(cipher_text: Optional[str], override_key: Optional[str] = None) -> Optional[str]:
    """
    Re-encrypt token with primary key if it was encrypted with an older key.
    If already encrypted with primary key or invalid, returns unmodified or None.
    """
    if not cipher_text:
        return None
    val = cipher_text.strip()
    if not val:
        return None
    if not is_fernet_ciphertext(val):
        return val

    mf = get_multi_fernet(override_key)
    try:
        return mf.rotate(val.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None
    except Exception:
        return None


def decrypt_token_detailed(
    cipher_or_plain: Optional[str],
    override_key: Optional[str] = None,
) -> tuple[Optional[str], str]:
    """
    Returns (decrypted_plaintext, status_code).
    Status codes:
      - 'ok:key_N': Successfully decrypted with candidate key index N
      - 'empty': Value is None or whitespace
      - 'plaintext': Raw non-ciphertext token (not recommended for production)
      - 'undecryptable': Ciphertext cannot be decrypted by any known candidate key
    """
    if not cipher_or_plain:
        return None, "empty"
    val = cipher_or_plain.strip()
    if not val:
        return None, "empty"
    if not is_fernet_ciphertext(val):
        return val, "plaintext"

    candidates = get_candidate_fernets(override_key)
    for idx, f in enumerate(candidates):
        try:
            plain = f.decrypt(val.encode("utf-8")).decode("utf-8")
            return plain, f"ok:key_{idx}"
        except InvalidToken:
            continue
        except Exception:
            continue

    return None, "undecryptable"


def decrypt_token(cipher_or_plain: Optional[str], override_key: Optional[str] = None) -> Optional[str]:
    """Decrypt a Fernet-encrypted token, with safe fallback for candidate keys and plaintext."""
    plain, _ = decrypt_token_detailed(cipher_or_plain, override_key)
    return plain


def check_crypto_config() -> None:
    """Log guidance on startup regarding CLASSROOM_FERNET_KEY configuration."""
    raw_key = os.getenv("CLASSROOM_FERNET_KEY") or getattr(settings, "classroom_fernet_key", "")
    if not raw_key and getattr(settings, "environment", "").lower() == "production":
        logger.warning(
            "CLASSROOM_FERNET_KEY is not set in production! Tokens are deriving their encryption from "
            "JWT_SECRET_KEY. Please set CLASSROOM_FERNET_KEY in Heroku Config Vars to ensure token persistence."
        )
