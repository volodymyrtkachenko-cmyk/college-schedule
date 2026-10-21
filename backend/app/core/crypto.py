"""Symmetric Fernet encryption for Google Classroom refresh tokens."""
import base64
import hashlib
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def get_fernet(override_key: Optional[str] = None) -> Fernet:
    """Return a Fernet instance using CLASSROOM_FERNET_KEY (or fallback secret)."""
    raw = (
        override_key
        or os.getenv("CLASSROOM_FERNET_KEY")
        or os.getenv("FERNET_KEY")
        or getattr(settings, "classroom_fernet_key", "")
        or ""
    ).strip()

    if raw:
        try:
            return Fernet(raw.encode("utf-8"))
        except Exception:
            digest = hashlib.sha256(raw.encode("utf-8")).digest()
            return Fernet(base64.urlsafe_b64encode(digest))

    fallback = (getattr(settings, "jwt_secret_key", "") or "college-schedule-fernet").encode("utf-8")
    digest = hashlib.sha256(fallback).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


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
    try:
        return get_fernet(override_key).decrypt(val.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        if not is_fernet_ciphertext(val):
            return val
        return None
    except Exception:
        return None
