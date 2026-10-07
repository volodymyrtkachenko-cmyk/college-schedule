from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
from pydantic import BaseModel, Field, ConfigDict

from app.database import get_db
from app.core.security import require_roles
from app.models.entities import EntityAlias

router = APIRouter(prefix="/aliases", tags=["aliases"])

class AliasCreate(BaseModel):
    entity_type: str = Field(..., description="'subject', 'teacher', or 'group'")
    parsed_name: str
    actual_id: int

class AliasResponse(AliasCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)

@router.get("", response_model=List[AliasResponse])
async def get_aliases(db: AsyncSession = Depends(get_db), _: object = Depends(require_roles("admin"))):
    result = await db.scalars(select(EntityAlias))
    return result.all()

@router.post("", response_model=AliasResponse)
async def create_alias(alias_in: AliasCreate, db: AsyncSession = Depends(get_db), _: object = Depends(require_roles("admin"))):
    parsed_name_clean = alias_in.parsed_name.strip()
    stmt = select(EntityAlias).where(EntityAlias.entity_type == alias_in.entity_type, EntityAlias.parsed_name == parsed_name_clean)
    if await db.scalar(stmt):
        raise HTTPException(status_code=400, detail="Така відповідність назви вже існує")
    db_alias = EntityAlias(entity_type=alias_in.entity_type, parsed_name=parsed_name_clean, actual_id=alias_in.actual_id)
    db.add(db_alias)
    await db.commit()
    await db.refresh(db_alias)
    return db_alias

@router.post("/bulk", response_model=dict)
async def create_aliases_bulk(aliases_in: List[AliasCreate], db: AsyncSession = Depends(get_db), _: object = Depends(require_roles("admin"))):
    """Convenience endpoint to create multiple aliases at once."""
    created = 0
    for alias_in in aliases_in:
        parsed_name_clean = alias_in.parsed_name.strip()
        stmt = select(EntityAlias).where(EntityAlias.entity_type == alias_in.entity_type, EntityAlias.parsed_name == parsed_name_clean)
        if await db.scalar(stmt):
            continue # Skip if already exists
        db_alias = EntityAlias(entity_type=alias_in.entity_type, parsed_name=parsed_name_clean, actual_id=alias_in.actual_id)
        db.add(db_alias)
        created += 1
    await db.commit()
    return {"status": "success", "inserted": created}

@router.delete("/{alias_id}", status_code=204)
async def delete_alias(alias_id: int, db: AsyncSession = Depends(get_db), _: object = Depends(require_roles("admin"))):
    alias = await db.scalar(select(EntityAlias).where(EntityAlias.id == alias_id))
    if not alias:
        raise HTTPException(status_code=404, detail="Відповідність назви не знайдено")
    await db.delete(alias)
    await db.commit()
    return None
