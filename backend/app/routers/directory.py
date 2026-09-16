"""Public directory reads and administrator-only directory management."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_roles
from app.database import get_db
from app.models import Faculty, Group, Subject, Teacher
from app.schemas import (
    FacultyCreate, FacultyResource, FacultyUpdate, GroupCreate, GroupResource,
    GroupUpdate, SubjectCreate,
    SubjectResource, SubjectUpdate, TeacherCreate, TeacherResource, TeacherUpdate,
)

router = APIRouter(tags=["directory"])
admin_router = APIRouter(
    prefix="/admin",
    tags=["admin-directory"],
    dependencies=[Depends(require_roles("admin"))],
)


async def items(model, db: AsyncSession):
    return (await db.scalars(
        select(model).where(model.is_active.is_(True)).order_by(model.name)
    )).all()


@router.get("/faculties", response_model=list[FacultyResource])
async def faculties(db: AsyncSession = Depends(get_db)):
    return await items(Faculty, db)


@router.get("/groups", response_model=list[GroupResource])
async def groups(db: AsyncSession = Depends(get_db)):
    return await items(Group, db)


@router.get("/teachers", response_model=list[TeacherResource])
async def teachers(db: AsyncSession = Depends(get_db)):
    return await items(Teacher, db)


@router.get("/subjects", response_model=list[SubjectResource])
async def subjects(db: AsyncSession = Depends(get_db)):
    return await items(Subject, db)


async def _duplicate(db, model, name: str, entity_id: int | None = None):
    query = select(model).where(model.name == name.strip())
    if entity_id is not None:
        query = query.where(model.id != entity_id)
    return await db.scalar(query)


async def _create(db, model, payload, response_model):
    data = payload.model_dump()
    data["name"] = data["name"].strip()
    if await _duplicate(db, model, data["name"]):
        raise HTTPException(409, f"Запис з такою назвою вже існує")
    entity = model(**data)
    db.add(entity)
    try:
        await db.commit()
        await db.refresh(entity)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Запис із такими даними вже існує") from exc
    return entity


async def _update(db, model, entity_id: int, payload):
    entity = await db.get(model, entity_id)
    if entity is None or not entity.is_active:
        raise HTTPException(404, f"Запис не знайдено")
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(422, "Необхідно вказати щонайменше одне поле")
    if "name" in data:
        data["name"] = data["name"].strip()
        if await _duplicate(db, model, data["name"], entity_id):
            raise HTTPException(409, f"Запис з такою назвою вже існує")
    for key, value in data.items():
        setattr(entity, key, value)
    try:
        await db.commit()
        await db.refresh(entity)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Запис із такими даними вже існує") from exc
    return entity


async def _active_fk(db, model, entity_id: int | None, label: str):
    if entity_id is None:
        return
    entity = await db.get(model, entity_id)
    if entity is None or not entity.is_active:
        raise HTTPException(422, f"{label} не існує або неактивний")


async def _soft_delete(db, model, entity_id: int):
    entity = await db.get(model, entity_id)
    if entity is None or not entity.is_active:
        raise HTTPException(404, f"Запис не знайдено")
    entity.is_active = False
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


admin = Depends(require_roles("admin"))


@router.post("/faculties", response_model=FacultyResource, status_code=201)
async def create_faculty(payload: FacultyCreate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _create(db, Faculty, payload, FacultyResource)


@router.patch("/faculties/{entity_id}", response_model=FacultyResource)
async def update_faculty(entity_id: int, payload: FacultyUpdate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _update(db, Faculty, entity_id, payload)


@router.delete("/faculties/{entity_id}", status_code=204)
async def delete_faculty(entity_id: int, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _soft_delete(db, Faculty, entity_id)


@router.post("/groups", response_model=GroupResource, status_code=201)
async def create_group(payload: GroupCreate, db: AsyncSession = Depends(get_db), _: object = admin):
    await _active_fk(db, Faculty, payload.faculty_id, "faculty")
    if "curator_id" in payload.model_fields_set:
        await _active_fk(db, Teacher, payload.curator_id, "teacher")
    return await _create(db, Group, payload, GroupResource)


@router.patch("/groups/{entity_id}", response_model=GroupResource)
async def update_group(entity_id: int, payload: GroupUpdate, db: AsyncSession = Depends(get_db), _: object = admin):
    if "faculty_id" in payload.model_fields_set:
        await _active_fk(db, Faculty, payload.faculty_id, "faculty")
    if "curator_id" in payload.model_fields_set:
        await _active_fk(db, Teacher, payload.curator_id, "teacher")
    return await _update(db, Group, entity_id, payload)


@router.delete("/groups/{entity_id}", status_code=204)
async def delete_group(entity_id: int, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _soft_delete(db, Group, entity_id)


@router.post("/teachers", response_model=TeacherResource, status_code=201)
async def create_teacher(payload: TeacherCreate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _create(db, Teacher, payload, TeacherResource)


@router.patch("/teachers/{entity_id}", response_model=TeacherResource)
async def update_teacher(entity_id: int, payload: TeacherUpdate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _update(db, Teacher, entity_id, payload)


@router.delete("/teachers/{entity_id}", status_code=204)
async def delete_teacher(entity_id: int, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _soft_delete(db, Teacher, entity_id)


@router.post("/subjects", response_model=SubjectResource, status_code=201)
async def create_subject(payload: SubjectCreate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _create(db, Subject, payload, SubjectResource)


@router.patch("/subjects/{entity_id}", response_model=SubjectResource)
async def update_subject(entity_id: int, payload: SubjectUpdate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _update(db, Subject, entity_id, payload)


@router.delete("/subjects/{entity_id}", status_code=204)
async def delete_subject(entity_id: int, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _soft_delete(db, Subject, entity_id)


@admin_router.get("/faculties", response_model=list[FacultyResource])
async def admin_faculties(db: AsyncSession = Depends(get_db)):
    return await items(Faculty, db)


@admin_router.get("/groups", response_model=list[GroupResource])
async def admin_groups(db: AsyncSession = Depends(get_db)):
    return await items(Group, db)


@admin_router.get("/teachers", response_model=list[TeacherResource])
async def admin_teachers(db: AsyncSession = Depends(get_db)):
    return await items(Teacher, db)


@admin_router.get("/subjects", response_model=list[SubjectResource])
async def admin_subjects(db: AsyncSession = Depends(get_db)):
    return await items(Subject, db)


for _path, _model, _create_endpoint, _update_endpoint, _delete_endpoint in (
    ("faculties", Faculty, create_faculty, update_faculty, delete_faculty),
    ("groups", Group, create_group, update_group, delete_group),
    ("teachers", Teacher, create_teacher, update_teacher, delete_teacher),
    ("subjects", Subject, create_subject, update_subject, delete_subject),
):
    _resource_models = {
        Faculty: FacultyResource,
        Group: GroupResource,
        Teacher: TeacherResource,
        Subject: SubjectResource,
    }
    admin_router.add_api_route(
        f"/{_path}", _create_endpoint, methods=["POST"],
        response_model=_resource_models[_model], status_code=201,
    )
    admin_router.add_api_route(
        f"/{_path}/{{entity_id}}", _update_endpoint, methods=["PATCH"],
        response_model=_resource_models[_model],
    )
    admin_router.add_api_route(
        f"/{_path}/{{entity_id}}", _delete_endpoint, methods=["DELETE"], status_code=204,
    )
