from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import require_roles, hash_password
from app.database import get_db
from app.models import User, Group

router = APIRouter(prefix="/admin/users", tags=["admin_users"])

class UserCreate(BaseModel):
    username: str = Field(min_length=3)
    name: str = Field(min_length=2)
    password: str = Field(min_length=8)
    role: Literal["admin", "editor", "viewer"] = "editor"
    allowed_groups: list[int] = Field(default_factory=list)

class UserUpdate(BaseModel):
    name: str | None = None
    password: str | None = Field(None, min_length=8)
    role: Literal["admin", "editor", "viewer"] | None = None
    allowed_groups: list[int] | None = None
    is_active: bool | None = None

class UserResourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str | None
    name: str
    role: str
    is_active: bool
    allowed_groups: list[int] = []


async def _groups_for_user(db: AsyncSession, group_ids: list[int]) -> list[Group]:
    if len(set(group_ids)) != len(group_ids) or any(group_id <= 0 for group_id in group_ids):
        raise HTTPException(status_code=422, detail="allowed_groups містить повторні або некоректні ідентифікатори")
    groups = list((await db.scalars(
        select(Group).where(Group.id.in_(group_ids), Group.is_active.is_(True))
    )).all()) if group_ids else []
    if len(groups) != len(group_ids):
        raise HTTPException(status_code=422, detail="Одна або кілька дозволених груп не існують або неактивні")
    return groups

@router.get("", response_model=list[UserResourceResponse])
async def get_users(db: AsyncSession = Depends(get_db), _: User = Depends(require_roles("admin"))):
    result = await db.scalars(select(User).options(selectinload(User.allowed_groups)))
    users = result.all()
    # Manual map to extract group ids
    resp = []
    for u in users:
        resp.append(UserResourceResponse(
            id=u.id, username=u.username, email=u.email, name=u.name, role=u.role, is_active=u.is_active,
            allowed_groups=[g.id for g in u.allowed_groups]
        ))
    return resp

@router.post("", response_model=UserResourceResponse, status_code=201)
async def create_user(payload: UserCreate, db: AsyncSession = Depends(get_db), _: User = Depends(require_roles("admin"))):
    user = await db.scalar(select(User).where(User.username == payload.username))
    if user:
        raise HTTPException(status_code=400, detail="Користувач вже існує")
        
    new_user = User(
        username=payload.username,
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=payload.role
    )
    if payload.role != "editor" and payload.allowed_groups:
        raise HTTPException(status_code=422, detail="allowed_groups дозволено лише для ролі editor")
    new_user.allowed_groups = await _groups_for_user(db, payload.allowed_groups)
        
    db.add(new_user)
    await db.commit()
    # No refresh to avoid MissingGreenlet on relationships
    return UserResourceResponse(
        id=new_user.id, username=new_user.username, email=new_user.email, name=new_user.name, role=new_user.role, is_active=new_user.is_active,
        allowed_groups=payload.allowed_groups if payload.role == "editor" else []
    )

@router.patch("/{user_id}", response_model=UserResourceResponse)
async def update_user(user_id: int, payload: UserUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_roles("admin"))):
    if user_id == 1 and payload.role == "editor":
        raise HTTPException(status_code=403, detail="Головному системному адміністратору не можна понизити права")
    user = await db.scalar(select(User).where(User.id == user_id).options(selectinload(User.allowed_groups)))
    if not user:
        raise HTTPException(status_code=404, detail="Користувач не знайдений")
        
    if payload.name is not None:
        user.name = payload.name
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
        
    target_role = payload.role if payload.role is not None else user.role
    if target_role != "editor" and (payload.allowed_groups or user.allowed_groups):
        if payload.allowed_groups:
            raise HTTPException(status_code=422, detail="allowed_groups дозволено лише для ролі editor")
        user.allowed_groups = []
    elif payload.allowed_groups is not None:
        user.allowed_groups = await _groups_for_user(db, payload.allowed_groups)
        
    await db.commit()
    # Avoid refresh to not hit MissingGreenlet on user.allowed_groups
    return UserResourceResponse(
        id=user.id, username=user.username, email=user.email, name=user.name, role=user.role, is_active=user.is_active,
        allowed_groups=payload.allowed_groups if payload.allowed_groups is not None else [g.id for g in user.allowed_groups]
    )

@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(require_roles("admin"))):
    if user_id == 1:
        raise HTTPException(status_code=403, detail="Головного системного адміністратора (ID 1) не можна видалити")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Ви не можете видалити самі себе")
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="Не знайдено")
    await db.delete(user)
    await db.commit()
