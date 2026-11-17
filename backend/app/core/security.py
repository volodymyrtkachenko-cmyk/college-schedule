import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import TokenBlocklist, User

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(password_hash.hash, password)


async def get_password_hash_async(password: str) -> str:
    return await asyncio.to_thread(password_hash.hash, password)


async def verify_password_async(password: str, hashed_password: str) -> bool:
    return await asyncio.to_thread(password_hash.verify, password, hashed_password)


def create_token(user: User, *, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user.id),
        "role": user.role,
        "type": token_type,
        "session_version": getattr(user, "session_version", 1),
        "iat": now,
        "exp": now + expires_delta,
        "jti": str(uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user: User) -> str:
    return create_token(
        user,
        token_type="access",
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )


def create_refresh_token(user: User) -> str:
    return create_token(
        user,
        token_type="refresh",
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
    )


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Термін дії сеансу завершився. Увійдіть знову.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    if payload.get("type") != expected_type or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Некоректний тип токена",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


async def is_token_blocklisted(db: AsyncSession, jti: str | None) -> bool:
    if not jti:
        return False
    blocked = await db.scalar(select(TokenBlocklist.id).where(TokenBlocklist.jti == jti))
    return blocked is not None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Потрібна авторизація",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials, "access")
    if await is_token_blocklisted(db, payload.get("jti")):
        raise HTTPException(status_code=401, detail="Сесія відкликана. Будь ласка, увійдіть знову.")
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Некоректний токен") from exc
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Користувач не активний або не існує")
    if payload.get("session_version") and payload.get("session_version") != getattr(user, "session_version", 1):
        raise HTTPException(status_code=401, detail="Сесія відкликана. Будь ласка, увійдіть знову.")
    return user


def require_roles(*roles: str):
    async def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Недостатньо прав")
        return user

    return dependency


def create_classroom_session_token(
    *,
    google_user_id: str | None = None,
    email: str | None = None,
    group_id: int | None = None,
    expires_days: int = 30,
) -> str:
    now = datetime.now(timezone.utc)
    clean_uid = (google_user_id or "").strip() or None
    clean_email = (email or "").strip().lower() or None
    if clean_email in ("підключено", "connected"):
        clean_email = None
    sub = clean_uid or clean_email or "classroom_user"
    payload: dict[str, Any] = {
        "sub": sub,
        "type": "classroom_session",
        "uid": clean_uid,
        "email": clean_email,
        "group_id": group_id,
        "iat": now,
        "exp": now + timedelta(days=expires_days),
        "jti": str(uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def verify_classroom_session_token(token: str | None) -> dict[str, Any] | None:
    if not token or not token.strip():
        return None
    try:
        payload = jwt.decode(
            token.strip(),
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "classroom_session":
        return None
    uid = (payload.get("uid") or "").strip() or None
    email = (payload.get("email") or "").strip().lower() or None
    if not uid and not email:
        return None
    return {
        "google_user_id": uid,
        "email": email,
        "group_id": payload.get("group_id"),
    }

