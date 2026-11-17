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


def _candidate_key_sources(override_key: Optional[str] = None) -> list[tuple[str, Optional[str]]]:
    """Ordered encryption seed candidates shared across crypto and diagnostics (names only exposed)."""
    sources: list[tuple[str, Optional[str]]] = []
    if override_key and override_key.strip():
        sources.append(("override", override_key))
    jwt_env = os.getenv("JWT_SECRET_KEY")
    jwt_cfg = getattr(settings, "jwt_secret_key", None)
    non_default_jwt = jwt_env or (jwt_cfg if jwt_cfg and jwt_cfg != LEGACY_DEV_KEY else None)
    sources.extend([
        ("ENCRYPTION_KEY", os.getenv("ENCRYPTION_KEY")),
        ("CLASSROOM_FERNET_KEY", os.getenv("CLASSROOM_FERNET_KEY")),
        ("CLASSROOM_FERNET_KEY", getattr(settings, "classroom_fernet_key", None)),
        ("FERNET_KEY", os.getenv("FERNET_KEY")),
        ("GOOGLE_CLIENT_SECRET", os.getenv("GOOGLE_CLIENT_SECRET") or getattr(settings, "google_client_secret", None)),
        ("JWT_SECRET_KEY", non_default_jwt),
        ("DATABASE_URL", os.getenv("DATABASE_URL") or getattr(settings, "database_url", None)),
    ])
    return sources


def get_encryption_key_source() -> str:
    """Return only the name of the active encryption seed source (never key material)."""
    for name, seed in _candidate_key_sources():
        if seed and str(seed).strip():
            return name
    return "dev_ephemeral_fallback"


def has_primary_encryption_key() -> bool:
    """True when a dedicated Fernet/encryption key env var is configured."""
    return get_encryption_key_source() in {"ENCRYPTION_KEY", "CLASSROOM_FERNET_KEY", "FERNET_KEY"}


def get_primary_raw_key(override_key: Optional[str] = None) -> str:
    """Return the raw string for the primary encryption key."""
    for _, seed in _candidate_key_sources(override_key):
        if seed and str(seed).strip():
            return str(seed).strip()
    return (getattr(settings, "jwt_secret_key", "") or LEGACY_DEV_KEY).strip()


def get_fernet(override_key: Optional[str] = None) -> Fernet:
    """Return the primary Fernet instance using primary key source."""
    return _fernet_from_raw(get_primary_raw_key(override_key))


def get_candidate_fernets(override_key: Optional[str] = None) -> list[Fernet]:
    """
    Return ordered list of Fernet instances to try during decryption.
    Primary key is always index 0. Subsequent keys include SHA-256 and historical keys.
    """
    fernets: list[Fernet] = []
    seen_hashes: set[bytes] = set()

    def _add_raw(raw_key: Optional[str]):
        if not raw_key:
            return
        cleaned = str(raw_key).strip()
        if not cleaned:
            return
        # Add direct Fernet key if valid, plus SHA-256 derived Fernet for legacy compatibility
        try:
            f_direct = Fernet(cleaned.encode("utf-8"))
            h_direct = hashlib.sha256(f"direct:{cleaned}".encode("utf-8")).digest()
            if h_direct not in seen_hashes:
                seen_hashes.add(h_direct)
                fernets.append(f_direct)
        except Exception:
            pass
        digest = hashlib.sha256(cleaned.encode("utf-8")).digest()
        h_sha = hashlib.sha256(b"sha256:" + digest).digest()
        if h_sha not in seen_hashes:
            seen_hashes.add(h_sha)
            fernets.append(Fernet(base64.urlsafe_b64encode(digest)))

    for _, seed in _candidate_key_sources(override_key):
        _add_raw(seed)

    # Configured old keys (comma-separated)
    old_keys_str = (
        os.getenv("CLASSROOM_FERNET_OLD_KEYS")
        or getattr(settings, "classroom_fernet_old_keys", "")
        or ""
    ).strip()
    if old_keys_str:
        for k in old_keys_str.split(","):
            _add_raw(k)

    # Secondary & legacy fallback seeds (decryption/rotation only, never primary encryption)
    _add_raw(os.getenv("SECRET_KEY"))
    _add_raw(getattr(settings, "jwt_secret_key", ""))
    _add_raw(os.getenv("JWT_SECRET_KEY", ""))
    _add_raw(getattr(settings, "google_client_secret", ""))
    _add_raw(getattr(settings, "database_url", ""))
    _add_raw("dfkr-college-schedule-persistent-key-2026")
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
    """Log guidance on startup regarding dedicated Classroom encryption key configuration."""
    if not has_primary_encryption_key() and getattr(settings, "environment", "").lower() == "production":
        logger.warning(
            "Dedicated CLASSROOM_FERNET_KEY / ENCRYPTION_KEY is not set in production! "
            "Tokens are deriving encryption from %s. Set CLASSROOM_FERNET_KEY in Heroku Config Vars.",
            get_encryption_key_source(),
        )
