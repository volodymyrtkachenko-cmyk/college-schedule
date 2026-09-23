from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
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
from app.models import User

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
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.refresh_token_expire_days * 86400,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.username == payload.username).options(selectinload(User.allowed_groups)))
    if user is None or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неправильне ім\'я користувача або пароль")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Обліковий запис неактивний")
    refresh_token = create_refresh_token(user)
    set_refresh_cookie(response, refresh_token)
    return TokenResponse(
        access_token=create_access_token(user),
        refresh_token=refresh_token,
        user=UserResponse(
            id=user.id, username=user.username, email=user.email, name=user.name, role=user.role, is_active=user.is_active,
            allowed_groups=[g.id for g in user.allowed_groups] if user.allowed_groups else []
        ),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    payload: RefreshRequest | None = None,
    refresh_cookie: str | None = Cookie(default=None, alias=settings.auth_cookie_name),
    db: AsyncSession = Depends(get_db),
):
    token = (payload.refresh_token if payload else None) or refresh_cookie
    if not token:
        raise HTTPException(status_code=401, detail="Потрібна авторизація")
    claims = decode_token(token, "refresh")
    try:
        user_id = int(claims["sub"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Некоректний токен") from exc
    user = await db.scalar(select(User).where(User.id == user_id).options(selectinload(User.allowed_groups)))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Користувач не активний або не існує")
    new_refresh = create_refresh_token(user)
    set_refresh_cookie(response, new_refresh)
    return TokenResponse(access_token=create_access_token(user), refresh_token=new_refresh, user=UserResponse(
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
