from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
from pydantic import BaseModel, Field

from app.database import get_db
from app.core.security import require_roles
from app.models.entities import EntityAlias
from app.models import Subject, Teacher, Group

router = APIRouter(prefix="/aliases", tags=["aliases"])

class AliasCreate(BaseModel):
    entity_type: str = Field(..., description="'subject', 'teacher', or 'group'")
    parsed_name: str
    actual_id: int

class AliasResponse(AliasCreate):
    id: int

    class Config:
        from_attributes = True

@router.get("", response_model=List[AliasResponse])
async def get_aliases(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin"))
):
    """Get all parsing aliases."""
    result = await db.scalars(select(EntityAlias))
    return result.all()

@router.post("", response_model=AliasResponse)
async def create_alias(
    alias_in: AliasCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin"))
):
    """Create a new parser alias mapping."""
    # Ensure it's uniquely formatted
    parsed_name_clean = alias_in.parsed_name.strip()
    
    # Check if duplicate exists
    stmt = select(EntityAlias).where(
        EntityAlias.entity_type == alias_in.entity_type,
        EntityAlias.parsed_name == parsed_name_clean
    )
    existing = await db.scalar(stmt)
    if existing:
        raise HTTPException(status_code=400, detail="Alias already exists")
        
    db_alias = EntityAlias(
        entity_type=alias_in.entity_type,
        parsed_name=parsed_name_clean,
        actual_id=alias_in.actual_id
    )
    db.add(db_alias)
    await db.commit()
    await db.refresh(db_alias)
    return db_alias

@router.delete("/{alias_id}", status_code=204)
async def delete_alias(
    alias_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_roles("admin"))
):
    """Delete an alias."""
    alias = await db.scalar(select(EntityAlias).where(EntityAlias.id == alias_id))
    if not alias:
        raise HTTPException(status_code=404, detail="Alias not found")
        
    await db.delete(alias)
    await db.commit()
    return None
