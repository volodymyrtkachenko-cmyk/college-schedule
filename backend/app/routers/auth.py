from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

from app.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    verify_password,
)
from app.database import get_db
from app.models import User, TokenBlocklist

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str | None
    name: str
    role: str
    is_active: bool
    allowed_groups: list[int] = []


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.refresh_token_expire_days * 86400,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="none" if settings.auth_cookie_secure else "lax",
        path="/",
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.username == payload.username).options(selectinload(User.allowed_groups)))
    if user is None or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неправильне ім'я користувача або пароль")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Обліковий запис неактивний")
    refresh_token = create_refresh_token(user)
    set_refresh_cookie(response, refresh_token)
    return TokenResponse(
        access_token=create_access_token(user),
        
        user=UserResponse(
            id=user.id, username=user.username, email=user.email, name=user.name, role=user.role, is_active=user.is_active,
            allowed_groups=[g.id for g in user.allowed_groups] if user.allowed_groups else []
        ),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    refresh_cookie: str | None = Cookie(default=None, alias=settings.auth_cookie_name),
    db: AsyncSession = Depends(get_db),
):
    token = refresh_cookie
    if not token:
        raise HTTPException(status_code=401, detail="Потрібна авторизація")
    claims = decode_token(token, "refresh")
    jti = claims.get("jti")
    
    try:
        user_id = int(claims["sub"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Некоректний токен") from exc
        
    user = await db.scalar(select(User).where(User.id == user_id).options(selectinload(User.allowed_groups)))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Користувач не активний або не існує")
        
    if jti:
        is_blocked = await db.scalar(select(TokenBlocklist).where(TokenBlocklist.jti == jti))
        if is_blocked:
            # Replay attack or double-use of refresh token: compromise signal. Revoke entire token family!
            user.session_version = getattr(user, "session_version", 1) + 1
            await db.commit()
            raise HTTPException(status_code=401, detail="Виявлено спробу компрометації. Усі ваші сеанси завершено. Увійдіть знову.")

    if claims.get("session_version") and claims.get("session_version") != getattr(user, "session_version", 1):
        raise HTTPException(status_code=401, detail="Сесія відкликана. Будь ласка, увійдіть знову.")
        
    # Valid refresh token. Consume it by adding to blocklist.
    if jti:
        db.add(TokenBlocklist(jti=jti))
        
    new_refresh = create_refresh_token(user)
    set_refresh_cookie(response, new_refresh)
    await db.commit()
    
    return TokenResponse(access_token=create_access_token(user),  user=UserResponse(
            id=user.id, username=user.username, email=user.email, name=user.name, role=user.role, is_active=user.is_active,
            allowed_groups=[g.id for g in user.allowed_groups] if user.allowed_groups else []
        ))



@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    u = await db.scalar(select(User).where(User.id == user.id).options(selectinload(User.allowed_groups)))
    return UserResponse(
        id=u.id,
        username=u.username,
        email=u.email,
        name=u.name,
        role=u.role,
        is_active=u.is_active,
        allowed_groups=[g.id for g in u.allowed_groups] if u.allowed_groups else []
    )

@router.post("/logout")
async def logout(
    response: Response,
    refresh_cookie: str | None = Cookie(default=None, alias=settings.auth_cookie_name),
    db: AsyncSession = Depends(get_db),
):
    claims = None
    if refresh_cookie:
        try:
            claims = decode_token(refresh_cookie, "refresh")
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
            # An invalid/expired cookie can be removed without a DB write.

    if claims is not None:
        jti = claims.get("jti")
        if not isinstance(jti, str) or not jti:
            raise HTTPException(401, "Некоректний refresh-токен")
        try:
            dialect = db.get_bind().dialect.name
            if dialect == "postgresql":
                from sqlalchemy.dialects.postgresql import insert
            elif dialect == "sqlite":
                from sqlalchemy.dialects.sqlite import insert
            else:
                raise RuntimeError("Unsupported auth database")
            statement = insert(TokenBlocklist).values(jti=jti)
            await db.execute(statement.on_conflict_do_nothing(index_elements=["jti"]))
            await db.commit()
        except Exception:
            await db.rollback()
            import logging
            from uuid import uuid4
            error_id = str(uuid4())
            logging.getLogger(__name__).exception("Logout persistence failed [%s]", error_id)
            raise HTTPException(503, detail={
                "msg": "Не вдалося завершити серверний сеанс. Спробуйте ще раз.",
                "error_id": error_id,
            })

    response.delete_cookie(
        key=settings.auth_cookie_name,
        secure=settings.auth_cookie_secure,
        samesite="none" if settings.auth_cookie_secure else "lax",
        path="/",
    )
    return {"status": "ok"}

@router.post("/revoke-all")
async def revoke_all(
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Revokes all active sessions for the current user.
    """
    user.session_version = getattr(user, "session_version", 1) + 1
    await db.commit()
    response.delete_cookie(
        key=settings.auth_cookie_name,
        secure=settings.cookie_secure,
        httponly=settings.cookie_httponly,
        samesite=settings.cookie_samesite,
        path="/"
    )
    return {"message": "Усі сеанси завершено"}
