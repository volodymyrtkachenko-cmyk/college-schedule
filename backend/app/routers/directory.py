"""Public directory reads and administrator-only directory management."""
from collections import defaultdict
import re
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_roles
from app.core.time import today_local
from app.database import get_db
from app.models import Faculty, Group, Schedule, ScheduleVersion, Subject, Teacher, User
from sqlalchemy.orm import selectinload
from app.schemas import (
    AtlasEdge, AtlasGroupNode, AtlasResponse, AtlasRoomNode,
    AtlasSubjectNode, AtlasSummary, AtlasTeacherNode,
    FacultyCreate, FacultyResource, FacultyUpdate, GroupCreate, GroupResource,
    GroupUpdate, SubjectCreate,
    SubjectResource, SubjectUpdate, TeacherCreate, TeacherResource, TeacherUpdate,
)

from app.services.directory_cache import _DIR_CACHE, invalidate_directory_cache
from app.services.projection import clean_room_string

router = APIRouter(tags=["directory"])
admin_router = APIRouter(
    prefix="/admin",
    tags=["admin-directory"],
    dependencies=[Depends(require_roles("admin", "editor"))],
)


async def items(model, db: AsyncSession):
    from app.services import cache_rev
    rev = cache_rev.global_rev
    key = (model, rev)
    cached = _DIR_CACHE.get(key)
    if cached is not None:
        return cached
    data = list((await db.scalars(
        select(model).where(model.is_active.is_(True)).order_by(model.name)
    )).all())
    for row in data:
        db.expunge(row)
    stale = [k for k in _DIR_CACHE if k[1] != rev]
    for k in stale:
        _DIR_CACHE.pop(k, None)
    _DIR_CACHE[key] = data
    return data


@router.get("/faculties", response_model=list[FacultyResource])
async def faculties(db: AsyncSession = Depends(get_db)):
    return await items(Faculty, db)


@router.get("/groups", response_model=list[GroupResource])
async def groups(db: AsyncSession = Depends(get_db)):
    return await items(Group, db)


@router.get("/teachers", response_model=list[TeacherResource])
async def teachers(db: AsyncSession = Depends(get_db)):
    all_teachers = await items(Teacher, db)
    return [t for t in all_teachers if t.name and "!" not in t.name]


@router.get("/subjects", response_model=list[SubjectResource])
async def subjects(db: AsyncSession = Depends(get_db)):
    return await items(Subject, db)


async def _duplicate(db, model, name: str, entity_id: int | None = None):
    if model is Subject:
        from app.services.importer.normalizer import name_key
        target_key = name_key(name)
        query = select(Subject)
        if entity_id is not None:
            query = query.where(Subject.id != entity_id)
        rows = (await db.scalars(query)).all()
        for row in rows:
            if name_key(row.name or "") == target_key:
                return row
        return None
    query = select(model).where(model.name == name.strip())
    if entity_id is not None:
        query = query.where(model.id != entity_id)
    return await db.scalar(query)


async def _create(db, model, payload, response_model):
    data = payload.model_dump()
    if model is Subject:
        from app.services.importer.normalizer import clean_name
        data["name"] = clean_name(data["name"])
    else:
        data["name"] = data["name"].strip()
    if await _duplicate(db, model, data["name"]):
        raise HTTPException(409, f"Запис з такою назвою вже існує")
    entity = model(**data)
    db.add(entity)
    try:
        await db.commit()
        await db.refresh(entity)
        _DIR_CACHE.clear()
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
        if model is Subject:
            from app.services.importer.normalizer import clean_name
            data["name"] = clean_name(data["name"])
        else:
            data["name"] = data["name"].strip()
        if await _duplicate(db, model, data["name"], entity_id):
            raise HTTPException(409, f"Запис з такою назвою вже існує")
    for key, value in data.items():
        setattr(entity, key, value)
    try:
        await db.commit()
        await db.refresh(entity)
        _DIR_CACHE.clear()
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
    _DIR_CACHE.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


admin = Depends(require_roles("admin"))
admin_or_editor = Depends(require_roles("admin", "editor"))


@router.get("/teacher-subjects", response_model=dict[int, list[int]])
async def teacher_subjects(response: Response, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select, and_, or_
    from app.models.entities import Schedule
    from app.services.cache_rev import get_schedule_cache_rev

    response.headers["Cache-Control"] = "public, max-age=60"

    rev = get_schedule_cache_rev()
    cache_key = ("teacher-subjects", rev)
    cached = _DIR_CACHE.get(cache_key)
    if cached is not None:
        return cached

    query1 = select(Schedule.teacher_id, Schedule.subject_id).where(
        and_(Schedule.is_active.is_(True), Schedule.teacher_id.is_not(None))
    ).distinct()

    query2 = select(Schedule.second_teacher_id, Schedule.subject_id).where(
        and_(Schedule.is_active.is_(True), Schedule.second_teacher_id.is_not(None))
    ).distinct()

    result1 = await db.execute(query1)
    result2 = await db.execute(query2)

    mapping: dict[int, set[int]] = {}
    for t_id, s_id in result1.all():
        if t_id not in mapping:
            mapping[t_id] = set()
        mapping[t_id].add(s_id)

    for t_id, s_id in result2.all():
        if t_id not in mapping:
            mapping[t_id] = set()
        mapping[t_id].add(s_id)

    result = {k: list(v) for k, v in mapping.items()}
    stale = [k for k in _DIR_CACHE if isinstance(k, tuple) and len(k) == 2 and k[0] == "teacher-subjects" and k[1] != rev]
    for k in stale:
        _DIR_CACHE.pop(k, None)
    _DIR_CACHE[cache_key] = result
    return result


_EMPTY_ROOM_MARKERS = {"-", "—", "–", "null", "none", "н/д"}
_FLOOR_RE = re.compile(r"^([1-9])\d{2}(?:[^\d]|$)")


def _normalize_atlas_room(raw: str | None) -> str | None:
    cleaned = clean_room_string(raw)
    if not cleaned:
        return None
    normalized = " ".join(cleaned.split())
    if not normalized or normalized.lower() in _EMPTY_ROOM_MARKERS:
        return None
    return normalized


def _extract_room_floor(room: str) -> int | None:
    match = _FLOOR_RE.match(room.strip())
    return int(match.group(1)) if match else None


@router.get("/atlas", response_model=AtlasResponse)
async def atlas(response: Response, db: AsyncSession = Depends(get_db)):
    from app.services import cache_rev
    from app.services.cache_rev import get_schedule_cache_rev

    response.headers["Cache-Control"] = "public, max-age=60"

    global_rev = cache_rev.global_rev
    sched_rev = get_schedule_cache_rev()
    cache_key = ("atlas", global_rev, sched_rev)
    cached = _DIR_CACHE.get(cache_key)
    if cached is not None:
        return cached

    faculties_rows = await items(Faculty, db)
    groups_rows = await items(Group, db)
    teachers_rows = [t for t in await items(Teacher, db) if t.name and "!" not in t.name]
    subjects_rows = await items(Subject, db)

    faculty_names = {f.id: f.name for f in faculties_rows}
    group_map = {g.id: g for g in groups_rows}
    teacher_map = {t.id: t for t in teachers_rows}
    subject_map = {s.id: s for s in subjects_rows}

    today = today_local()
    active_version = await db.scalar(
        select(ScheduleVersion)
        .where(
            ScheduleVersion.valid_from <= today,
            ScheduleVersion.valid_until >= today,
            ScheduleVersion.is_active.is_(True),
        )
        .order_by(ScheduleVersion.valid_from.desc())
        .limit(1)
    )
    if active_version is not None:
        version_filter = Schedule.version_id == active_version.id
    else:
        has_unversioned = await db.scalar(
            select(Schedule.id)
            .where(Schedule.is_active.is_(True), Schedule.version_id.is_(None))
            .limit(1)
        )
        if has_unversioned is not None:
            version_filter = Schedule.version_id.is_(None)
        else:
            latest_active = await db.scalar(
                select(ScheduleVersion)
                .where(ScheduleVersion.is_active.is_(True))
                .order_by(ScheduleVersion.valid_from.desc())
                .limit(1)
            )
            version_filter = (
                Schedule.version_id == latest_active.id
                if latest_active is not None
                else Schedule.version_id.is_(None)
            )

    schedule_rows = (
        await db.scalars(
            select(Schedule).where(
                and_(
                    Schedule.is_active.is_(True),
                    version_filter,
                    Schedule.teacher_id.is_not(None),
                    or_(Schedule.effective_until.is_(None), Schedule.effective_until >= today),
                )
            )
        )
    ).all()

    edge_counts: dict[tuple[int, int, int | None, int, str | None], int] = defaultdict(int)
    edge_days: dict[tuple[int, int, int | None, int, str | None], set[int]] = defaultdict(set)

    group_lessons: dict[int, int] = defaultdict(int)
    teacher_lessons: dict[int, int] = defaultdict(int)
    teacher_groups: dict[int, set[int]] = defaultdict(set)
    teacher_subjects_map: dict[int, set[int]] = defaultdict(set)

    subject_lessons: dict[int, int] = defaultdict(int)
    subject_groups: dict[int, set[int]] = defaultdict(set)
    subject_teachers: dict[int, set[int]] = defaultdict(set)

    room_lessons: dict[str, int] = defaultdict(int)
    room_groups: dict[str, set[int]] = defaultdict(set)
    room_teachers: dict[str, set[int]] = defaultdict(set)

    for row in schedule_rows:
        if (
            row.group_id not in group_map
            or row.subject_id not in subject_map
            or row.teacher_id not in teacher_map
        ):
            continue

        sec_id = (
            row.second_teacher_id
            if row.second_teacher_id
            and row.second_teacher_id in teacher_map
            and row.second_teacher_id != row.teacher_id
            else None
        )
        primary_teacher = teacher_map[row.teacher_id]
        eff_room = _normalize_atlas_room(row.room_override) or _normalize_atlas_room(primary_teacher.room)

        edge_key = (row.group_id, row.teacher_id, sec_id, row.subject_id, eff_room)
        edge_counts[edge_key] += 1
        if 1 <= row.day_of_week <= 7:
            edge_days[edge_key].add(row.day_of_week)

        group_lessons[row.group_id] += 1
        subject_lessons[row.subject_id] += 1
        subject_groups[row.subject_id].add(row.group_id)

        involved_teachers = (row.teacher_id,) if sec_id is None else (row.teacher_id, sec_id)
        for tid in involved_teachers:
            teacher_lessons[tid] += 1
            teacher_groups[tid].add(row.group_id)
            teacher_subjects_map[tid].add(row.subject_id)
            subject_teachers[row.subject_id].add(tid)

        if eff_room:
            room_lessons[eff_room] += 1
            room_groups[eff_room].add(row.group_id)
            for tid in involved_teachers:
                room_teachers[eff_room].add(tid)

    group_nodes = [
        AtlasGroupNode(
            id=g.id,
            name=g.name,
            course=g.course,
            faculty_id=g.faculty_id,
            faculty_name=faculty_names.get(g.faculty_id) if g.faculty_id else None,
            curator_id=g.curator_id if g.curator_id in teacher_map else None,
            lessons_count=group_lessons.get(g.id, 0),
        )
        for g in groups_rows
    ]

    teacher_nodes = [
        AtlasTeacherNode(
            id=t.id,
            name=t.name,
            full_name=t.full_name,
            room=_normalize_atlas_room(t.room),
            groups_count=len(teacher_groups.get(t.id, ())),
            subjects_count=len(teacher_subjects_map.get(t.id, ())),
            lessons_count=teacher_lessons.get(t.id, 0),
        )
        for t in teachers_rows
    ]

    subject_nodes = [
        AtlasSubjectNode(
            id=s.id,
            name=s.name,
            short_name=s.short_name,
            groups_count=len(subject_groups.get(s.id, ())),
            teachers_count=len(subject_teachers.get(s.id, ())),
            lessons_count=subject_lessons.get(s.id, 0),
        )
        for s in subjects_rows
    ]

    room_nodes = [
        AtlasRoomNode(
            id=room_name,
            name=room_name,
            floor=_extract_room_floor(room_name),
            groups_count=len(room_groups.get(room_name, ())),
            teachers_count=len(room_teachers.get(room_name, ())),
            lessons_count=room_lessons.get(room_name, 0),
        )
        for room_name in sorted(room_lessons.keys())
    ]

    edges = [
        AtlasEdge(
            group_id=gid,
            teacher_id=tid,
            second_teacher_id=sec_tid,
            subject_id=sid,
            room=eff_room,
            lessons_count=count,
            days=sorted(edge_days[(gid, tid, sec_tid, sid, eff_room)]),
        )
        for (gid, tid, sec_tid, sid, eff_room), count in sorted(
            edge_counts.items(),
            key=lambda item: (-item[1], item[0][0], item[0][1], item[0][3]),
        )
    ]

    payload = AtlasResponse(
        summary=AtlasSummary(
            groups_count=len(group_nodes),
            teachers_count=len(teacher_nodes),
            subjects_count=len(subject_nodes),
            rooms_count=len(room_nodes),
            edges_count=len(edges),
        ),
        groups=group_nodes,
        teachers=teacher_nodes,
        subjects=subject_nodes,
        rooms=room_nodes,
        edges=edges,
    )

    stale = [
        k
        for k in _DIR_CACHE
        if isinstance(k, tuple) and len(k) == 3 and k[0] == "atlas" and (k[1] != global_rev or k[2] != sched_rev)
    ]
    for k in stale:
        _DIR_CACHE.pop(k, None)
    _DIR_CACHE[cache_key] = payload
    return payload

@admin_router.post("/faculties", response_model=FacultyResource, status_code=201)

async def create_faculty(payload: FacultyCreate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _create(db, Faculty, payload, FacultyResource)


@admin_router.patch("/faculties/{entity_id}", response_model=FacultyResource)
async def update_faculty(entity_id: int, payload: FacultyUpdate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _update(db, Faculty, entity_id, payload)


@admin_router.delete("/faculties/{entity_id}", status_code=204)
async def delete_faculty(entity_id: int, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _soft_delete(db, Faculty, entity_id)


@admin_router.post("/groups", response_model=GroupResource, status_code=201)
async def create_group(payload: GroupCreate, db: AsyncSession = Depends(get_db), _: object = admin):
    await _active_fk(db, Faculty, payload.faculty_id, "faculty")
    if "curator_id" in payload.model_fields_set:
        await _active_fk(db, Teacher, payload.curator_id, "teacher")
    return await _create(db, Group, payload, GroupResource)


@admin_router.patch("/groups/{entity_id}", response_model=GroupResource)
async def update_group(
    entity_id: int,
    payload: GroupUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = admin_or_editor,
):
    if current_user.role == "editor":
        u = await db.scalar(
            select(User).options(selectinload(User.allowed_groups)).where(User.id == current_user.id)
        )
        allowed_ids = {g.id for g in u.allowed_groups} if u else set()
        if entity_id not in allowed_ids:
            raise HTTPException(status_code=403, detail="Ви не маєте доступу до цієї групи")
    if "faculty_id" in payload.model_fields_set:
        await _active_fk(db, Faculty, payload.faculty_id, "faculty")
    if "curator_id" in payload.model_fields_set:
        await _active_fk(db, Teacher, payload.curator_id, "teacher")
    return await _update(db, Group, entity_id, payload)


@admin_router.delete("/groups/{entity_id}", status_code=204)
async def delete_group(entity_id: int, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _soft_delete(db, Group, entity_id)


@admin_router.post("/teachers", response_model=TeacherResource, status_code=201)
async def create_teacher(payload: TeacherCreate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _create(db, Teacher, payload, TeacherResource)


@admin_router.patch("/teachers/{entity_id}", response_model=TeacherResource)
async def update_teacher(entity_id: int, payload: TeacherUpdate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _update(db, Teacher, entity_id, payload)


@admin_router.delete("/teachers/{entity_id}", status_code=204)
async def delete_teacher(entity_id: int, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _soft_delete(db, Teacher, entity_id)


@admin_router.post("/subjects", response_model=SubjectResource, status_code=201)
async def create_subject(payload: SubjectCreate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _create(db, Subject, payload, SubjectResource)


@admin_router.patch("/subjects/{entity_id}", response_model=SubjectResource)
async def update_subject(entity_id: int, payload: SubjectUpdate, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _update(db, Subject, entity_id, payload)


@admin_router.delete("/subjects/{entity_id}", status_code=204)
async def delete_subject(entity_id: int, db: AsyncSession = Depends(get_db), _: object = admin):
    return await _soft_delete(db, Subject, entity_id)


@admin_router.get("/faculties", response_model=list[FacultyResource])
async def admin_faculties(db: AsyncSession = Depends(get_db), _: object = admin):
    return await items(Faculty, db)


@admin_router.get("/groups", response_model=list[GroupResource])
async def admin_groups(db: AsyncSession = Depends(get_db), current_user: User = admin_or_editor):
    all_groups = await items(Group, db)
    if current_user.role == "editor":
        u = await db.scalar(
            select(User).options(selectinload(User.allowed_groups)).where(User.id == current_user.id)
        )
        allowed_ids = {g.id for g in u.allowed_groups} if u else set()
        return [g for g in all_groups if g.id in allowed_ids]
    return all_groups


@admin_router.get("/teachers", response_model=list[TeacherResource])
async def admin_teachers(db: AsyncSession = Depends(get_db), _: object = admin):
    return await items(Teacher, db)


@admin_router.get("/subjects", response_model=list[SubjectResource])
async def admin_subjects(db: AsyncSession = Depends(get_db), _: object = admin):
    return await items(Subject, db)


@router.get("/metrics")
async def get_metrics():
    from app.analytics import get_system_metrics
    return get_system_metrics()
