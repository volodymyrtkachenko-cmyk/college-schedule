import asyncio
import hashlib
import logging
import re
import time as _time
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import KYIV_TZ
from app.models import (
    ClassroomCredential,
    ClassroomGroupBinding,
    Group,
    GroupStudent,
    Schedule,
    Teacher,
)
from app.models.lesson_notes import LessonOccurrenceNote
from app.schemas.classroom import ClassroomDisconnectRequest, ClassroomSyncRequest
from app.services.classroom import state as classroom_state
from app.services.classroom import tokens as classroom_tokens
from app.services.classroom.parser import (
    BELL_END_MINUTES,
    ONLINE_HINT_RE,
    URL_RE,
    _extract_group_from_course_name,
    _fold,
    _link_line_belongs_to_sync,
    _matches_lesson,
    _norm,
    _parse_announcement,
    _resolve_matched_teacher_surname,
    _task_line_belongs_to_sync,
)
from app.services.classroom.state import (
    CACHE_TTL_TEACHERS_TOPICS,
    _SYNC_LOCK_GROUPS,
    _course_teachers_cache,
    _course_topics_cache,
    _iso_utc,
    _last_students_synced_at,
    _latest_group_tasks,
    _latest_scope_missing,
    _latest_unmapped_tasks,
    _read_classroom_heartbeat,
    _sync_backoff_state,
)
from app.services.classroom.storage import _save_link_to_slot, _upsert_task_line
from app.services.classroom.tokens import (
    RECOMMENDED_CLASSROOM_SCOPES,
    REQUIRED_CLASSROOM_SCOPES,
    _apply_credential_backoff,
    _is_permanent_courses_error,
    _is_permanent_token_error,
    _sanitize_error_msg,
    decrypt_token,
    encrypt_token,
    rotate_token,
)
from app.services.projection import build_week_projection

logger = logging.getLogger(__name__)


async def perform_course_sync(
    db: AsyncSession,
    group: Group,
    courses: list[dict],
    access_token: str,
    group_course_id: Optional[str] = None,
    week_start: Optional[date] = None,
    skip_course_ids: Optional[set[str]] = None,
    prefetched_user_email: Optional[str] = None,
    prefetched_google_user_id: Optional[str] = None,
    force: bool = False,
) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    synced_links = 0
    synced_tasks = 0
    synced_students = 0

    now_kyiv = datetime.now(KYIV_TZ)
    today_real = now_kyiv.date()
    current_monday = today_real - timedelta(days=today_real.weekday())

    today_kyiv = week_start or today_real
    if week_start is None and today_kyiv.weekday() in (5, 6):
        today_kyiv = today_kyiv + timedelta(days=(7 - today_kyiv.weekday()))
    week_monday = today_kyiv - timedelta(days=today_kyiv.weekday())
    week_friday = week_monday + timedelta(days=4)

    # Вікно збереження ДЗ та посилань: попередні 2 тижні (lookback 14 днів) + поточний + наступний тиждень,
    # щоб завдання та посилання минулих тижнів прив'язувалися до пар свого тижня й не стиралися
    TASKS_LOOKBACK_DAYS = 14
    tasks_window_start = min(current_monday, week_monday)
    tasks_lookback_start = tasks_window_start - timedelta(days=TASKS_LOOKBACK_DAYS)
    tasks_window_end = max(current_monday, week_monday) + timedelta(days=11)  # п'ятниця наступного тижня
    links_window_start = tasks_lookback_start
    links_window_end = max(current_monday + timedelta(days=4), week_friday)
    unmapped_tasks: list[dict] = []

    db_teachers = (await db.scalars(select(Teacher))).all()

    skipped_ids = {str(cid) for cid in (skip_course_ids or set()) if cid}
    effective_courses = [c for c in courses if str(c.get("id") or "") not in skipped_ids]
    current_sync_course_ids = {str(c.get("id")) for c in effective_courses if c.get("id")}

    # КРОК 1: Розумне очищення старих авто-посилань та старих [TASK]
    # Завдання інших підгруп/курсів (наприклад, іншої підгрупи англійської мови),
    # яких немає у поточному списку курсів користувача, дбайливо ЗБЕРІГАЮТЬСЯ (Smart Merge)!
    all_group_notes_all = (
        await db.scalars(
            select(LessonOccurrenceNote)
            .where(LessonOccurrenceNote.group_id == group.id)
            .order_by(LessonOccurrenceNote.id.asc())
        )
    ).all()
    all_group_notes = [gn for gn in all_group_notes_all if not gn.archived]

    for gn in all_group_notes:
        manual_lines = []
        for line in gn.note.split("\n"):
            l_str = line.strip()
            if not l_str:
                continue
            if l_str.startswith("[TASK"):
                # Завдання [TASK] не видаляємо наосліп до завантаження авторів курсів:
                # у КРОЦІ 1b прибираємо лише ті [TASK], що належать викладачам ПОТОЧНОГО синку.
                # Завдання іншої підгрупи (навіть зі спільного курсу!) дбайливо зберігаються.
                manual_lines.append(l_str)
                continue
            if "classroom.google.com/" in l_str.lower():
                continue
            if URL_RE.search(l_str):
                # Посилання не видаляємо наосліп: після завантаження викладачів курсів (КРОК 1b)
                # прибираємо лише ті, що належать викладачам ПОТОЧНОГО синку. Посилання іншої підгрупи лишаються.
                manual_lines.append(l_str)
                continue
            if re.search(r"(?:Код|ID|Passcode|Пароль)\s*:", l_str, re.IGNORECASE):
                continue
            manual_lines.append(l_str)

        if manual_lines:
            new_text = "\n".join(manual_lines)
            if gn.note != new_text:
                gn.note = new_text
                gn.revision += 1
                gn.updated_at = datetime.now(timezone.utc)
        else:
            gn.archived = True
            gn.revision += 1
            gn.updated_at = datetime.now(timezone.utc)

    # Додатковий захист: очищаємо залишкові авто-нотатки з інших груп,
    # які не мають власних активних прив'язок до Classroom
    active_binding_group_ids = set(
        (await db.scalars(select(ClassroomGroupBinding.group_id).where(ClassroomGroupBinding.is_active.is_(True)))).all()
    ) | set(
        (await db.scalars(select(ClassroomCredential.group_id).where(ClassroomCredential.is_active.is_(True)))).all()
    ) | {group.id}
    orphan_notes = (
        await db.scalars(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id.not_in(active_binding_group_ids),
                LessonOccurrenceNote.archived.is_(False),
                (LessonOccurrenceNote.note.like("%[TASK%") | LessonOccurrenceNote.note.like("%meet.google.com%") | LessonOccurrenceNote.note.like("%zoom.us%")),
            )
        )
    ).all()
    for on in orphan_notes:
        clean_lines = [
            l.strip()
            for l in on.note.split("\n")
            if l.strip()
            and not l.strip().startswith("[TASK")
            and not URL_RE.search(l)
            and not re.search(r"(?:Код|ID|Passcode|Пароль)\s*:", l, re.IGNORECASE)
        ]
        if clean_lines:
            on.note = "\n".join(clean_lines)
        else:
            on.archived = True
        on.revision += 1
        on.updated_at = datetime.now(timezone.utc)

    await db.flush()

    # КРОК 2: Завантажуємо розклад на розширений горизонт (2 тижні назад + поточний + наступний тиждень)
    horizon_lessons_by_date: dict[date, list] = {}
    for w_offset in (-2, -1, 0, 1):
        w_mon = tasks_window_start + timedelta(days=w_offset * 7)
        _, w_by_day = await build_week_projection(db, w_mon, group_id=group.id)
        for weekday in range(1, 6):
            d = w_mon + timedelta(days=weekday - 1)
            horizon_lessons_by_date[d] = [
                l for l in w_by_day.get(weekday, [])
                if getattr(l, "subject_id", None)
                and (1 <= getattr(l, "lesson_number", 0) <= 4)
                and not getattr(l, "is_cancelled", False)
            ]

    parsed_announcements: list[dict] = []
    raw_coursework_items: list[dict] = []
    all_classroom_tasks: list[dict] = []
    course_cw_total: dict[str, int] = {}
    course_cw_active: dict[str, int] = {}
    teacher_tokens_by_uid: dict[str, list[str]] = {}

    async with httpx.AsyncClient(timeout=15.0) as client:
        user_email: Optional[str] = prefetched_user_email
        google_user_id: Optional[str] = prefetched_google_user_id
        if not user_email or not google_user_id:
            try:
                me_resp = await client.get(
                    "https://classroom.googleapis.com/v1/userProfiles/me",
                    headers=headers,
                )
                if me_resp.status_code == 200:
                    me_data = me_resp.json()
                    user_email = user_email or me_data.get("emailAddress")
                    google_user_id = google_user_id or (me_data.get("id") or "").strip() or None
            except Exception as e:
                logger.warning(f"Could not fetch user profile: {_sanitize_error_msg(str(e))}")

        if not user_email or not google_user_id:
            try:
                uinfo_resp = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers=headers,
                )
                if uinfo_resp.status_code == 200:
                    uinfo = uinfo_resp.json()
                    user_email = user_email or (uinfo.get("email") or "").strip() or None
                    google_user_id = google_user_id or str(uinfo.get("sub") or "").strip() or None
            except Exception as e:
                logger.warning(f"Could not fetch oauth2 userinfo: {_sanitize_error_msg(str(e))}")

        all_active_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()
        target_group_courses = []
        relevant_courses = []

        for c in effective_courses:
            full_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
            matched_g = _extract_group_from_course_name(full_title, all_active_groups)
            if matched_g:
                if matched_g.id == group.id:
                    target_group_courses.append(c)
                    relevant_courses.append(c)
                # Якщо курс містить назву іншої групи — КАТЕГОРИЧНО ігноруємо його для поточної групи!
            else:
                relevant_courses.append(c)
                if group_course_id and c.get("id") == group_course_id:
                    target_group_courses.append(c)

        if not target_group_courses and effective_courses and not skipped_ids:
            # Якщо немає курсів з назвою групи, беремо лише той курс, який безпосередньо прив'язаний
            target_group_courses = [c for c in effective_courses if group_course_id and c.get("id") == group_course_id] or [effective_courses[0]]
        if not relevant_courses and not skipped_ids:
            relevant_courses = target_group_courses

        # 1. Розумна синхронізація списку студентів (1 раз на добу або при force=True)
        now_utc = datetime.now(timezone.utc)
        last_stud_sync = _last_students_synced_at.get(group.id)
        should_sync_students = (
            force
            or (last_stud_sync is None)
            or ((now_utc - last_stud_sync).total_seconds() >= 24 * 3600)
        )

        if should_sync_students:
            students_by_user_id: dict[str, dict] = {}
            for gc in target_group_courses:
                c_id = gc.get("id")
                if not c_id:
                    continue
                try:
                    page_token = None
                    while True:
                        params: dict[str, Any] = {"pageSize": 100}
                        if page_token:
                            params["pageToken"] = page_token
                        s_resp = await client.get(
                            f"https://classroom.googleapis.com/v1/courses/{c_id}/students",
                            params=params,
                            headers=headers,
                        )
                        if s_resp.status_code != 200:
                            break
                        s_data = s_resp.json()
                        for s_item in s_data.get("students", []):
                            uid = (s_item.get("userId") or "").strip()
                            prof = s_item.get("profile", {})
                            s_name = prof.get("name", {}).get("fullName", "").strip()
                            if not s_name or not uid:
                                continue
                            photo = prof.get("photoUrl")
                            if photo and photo.startswith("//"):
                                photo = f"https:{photo}"
                            email = (prof.get("emailAddress") or "").strip()

                            if uid not in students_by_user_id:
                                students_by_user_id[uid] = {
                                    "classroom_user_id": uid[:64],
                                    "full_name": s_name[:150],
                                    "email": email[:150] or None,
                                    "photo_url": photo[:2048] if photo else None,
                                }
                            else:
                                if not students_by_user_id[uid]["email"] and email:
                                    students_by_user_id[uid]["email"] = email[:150]
                                if not students_by_user_id[uid]["photo_url"] and photo:
                                    students_by_user_id[uid]["photo_url"] = photo[:2048]

                        page_token = s_data.get("nextPageToken")
                        if not page_token:
                            break
                except Exception as e:
                    logger.warning(f"Could not sync students for course {c_id}: {_sanitize_error_msg(str(e))}")

            # Пошук одногрупників через Google People Directory API (@kre.dp.ua)
            if target_group_courses:
                try:
                    search_queries = [group.name]
                    for gc in target_group_courses:
                        c_name = (gc.get("name") or "").strip()
                        if c_name and c_name not in search_queries:
                            search_queries.append(c_name)

                    for sq in search_queries[:2]:
                        people_resp = await client.get(
                            "https://people.googleapis.com/v1/people:searchDirectoryPeople",
                            params={
                                "query": sq,
                                "readMask": "names,emailAddresses,photos,organizations",
                                "sources": ["DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE"],
                                "pageSize": 100,
                            },
                            headers=headers,
                        )
                        if people_resp.status_code == 200:
                            for person in people_resp.json().get("people", []):
                                names = person.get("names", [])
                                full_name = names[0].get("displayName", "").strip() if names else ""
                                emails = person.get("emailAddresses", [])
                                email = emails[0].get("value", "").strip() if emails else ""
                                photos = person.get("photos", [])
                                photo = photos[0].get("url") if photos else None

                                if not full_name:
                                    continue

                                p_uid = f"dir_{abs(hash(email or full_name)) % (10**12)}"
                                if p_uid not in students_by_user_id:
                                    students_by_user_id[p_uid] = {
                                        "classroom_user_id": p_uid[:64],
                                        "full_name": full_name[:150],
                                        "email": email[:150] or None,
                                        "photo_url": photo[:2048] if photo else None,
                                    }
                except Exception as e:
                    logger.warning(f"People API directory search skipped: {_sanitize_error_msg(str(e))}")

            existing_students = (
                await db.scalars(
                    select(GroupStudent).where(GroupStudent.group_id == group.id)
                )
            ).all()
            existing_by_uid = {s.classroom_user_id: s for s in existing_students if s.classroom_user_id}
            existing_by_name = {_norm(s.full_name): s for s in existing_students}

            for uid, s_info in students_by_user_id.items():
                norm_name = _norm(s_info["full_name"])
                target_row = existing_by_uid.get(uid) or existing_by_name.get(norm_name)
                if target_row:
                    if uid and not target_row.classroom_user_id.startswith("manual_"):
                        target_row.classroom_user_id = uid
                    target_row.full_name = s_info["full_name"]
                    if s_info["email"]:
                        target_row.email = s_info["email"]
                    if s_info["photo_url"]:
                        target_row.photo_url = s_info["photo_url"]
                else:
                    db.add(
                        GroupStudent(
                            group_id=group.id,
                            classroom_user_id=s_info["classroom_user_id"],
                            full_name=s_info["full_name"],
                            email=s_info["email"],
                            photo_url=s_info["photo_url"],
                        )
                    )
                    synced_students += 1
            await db.flush()
            _last_students_synced_at[group.id] = now_utc
        else:
            logger.debug(
                "Classroom sync group_id=%s: skipping students sync (already synced within 24h at %s)",
                group.id,
                last_stud_sync.isoformat() if last_stud_sync else None,
            )

        # 2. ПАРАЛЕЛЬНЕ сканування курсів з кешуванням статичних teachers та topics (TTL 12 годин)
        sem = asyncio.Semaphore(4)
        now_mono = _time.monotonic()

        async def fetch_course_bundle(course: dict):
            c_id = course["id"]
            async with sem:
                async def _get_teachers():
                    if not force and c_id in _course_teachers_cache:
                        ts, resp = _course_teachers_cache[c_id]
                        if now_mono - ts < CACHE_TTL_TEACHERS_TOPICS:
                            return resp
                    resp = await client.get(
                        f"https://classroom.googleapis.com/v1/courses/{c_id}/teachers",
                        headers=headers,
                    )
                    if getattr(resp, "status_code", 0) == 200:
                        _course_teachers_cache[c_id] = (now_mono, resp)
                    return resp

                async def _get_topics():
                    if not force and c_id in _course_topics_cache:
                        ts, resp = _course_topics_cache[c_id]
                        if now_mono - ts < CACHE_TTL_TEACHERS_TOPICS:
                            return resp
                    resp = await client.get(
                        f"https://classroom.googleapis.com/v1/courses/{c_id}/topics",
                        params={"pageSize": 50},
                        headers=headers,
                    )
                    if getattr(resp, "status_code", 0) == 200:
                        _course_topics_cache[c_id] = (now_mono, resp)
                    return resp

                a_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/announcements",
                    params={"pageSize": 100},
                    headers=headers,
                )
                cw_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWork",
                    params={"pageSize": 100},
                    headers=headers,
                )
                mat_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWorkMaterials",
                    params={"pageSize": 100},
                    headers=headers,
                )
                sub_task = client.get(
                    f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWork/-/studentSubmissions",
                    params={"userId": "me", "pageSize": 100},
                    headers=headers,
                )
                return course, await asyncio.gather(
                    _get_teachers(), a_task, cw_task, _get_topics(), mat_task, sub_task, return_exceptions=True
                )

        bundles = await asyncio.gather(*(fetch_course_bundle(c) for c in relevant_courses[:30]))

        course_teachers_tokens: dict[str, list[str]] = {}
        course_teacher_count: dict[str, int] = {}
        course_teacher_uids: dict[str, list[str]] = {}
        teacher_name_by_uid: dict[str, str] = {}
        student_dominant_uid_by_course: dict[str, str] = {}
        topics_by_course: dict[str, dict[str, str]] = {}
        missing_creators: set[tuple[str, str]] = set()
        turned_in_cw_ids: set[str] = set()
        submissions_by_cw_id: dict[str, dict] = {}
        course_student_cw_ids: dict[str, set[str]] = {}
        has_submission_scope_error = False
        synced_teacher_names: set[str] = set()
        synced_teacher_tokens: set[str] = set()
        synced_subgroups: set[int] = set()
        personal_classroom_tasks: list[dict] = []

        # Прохід 1: Парсимо вже отриманих викладачів/теми та збираємо невідомі creatorUserId
        for course, bundle_items in bundles:
            c_title = f"{course.get('name', '')} {course.get('section', '')}".strip()
            c_low = c_title.lower()
            if re.search(r"\b1\s*[-–—]?\s*(?:ша\s*)?підгр", c_low):
                synced_subgroups.add(1)
            if re.search(r"\b2\s*[-–—]?\s*(?:га\s*)?підгр", c_low):
                synced_subgroups.add(2)

            if len(bundle_items) >= 6:
                t_resp, ann_resp, cw_resp, top_resp, mat_resp, sub_resp = bundle_items[:6]
            else:
                t_resp, ann_resp, cw_resp, top_resp, mat_resp = bundle_items[:5]
                sub_resp = None

            course_id = course["id"]
            course_teachers_tokens[course_id] = []
            course_teacher_count[course_id] = 0
            course_teacher_uids[course_id] = []
            course_student_cw_ids[course_id] = set()
            topics_by_id: dict[str, str] = {}

            if getattr(sub_resp, "status_code", None) == 403:
                has_submission_scope_error = True
            elif sub_resp is not None and not isinstance(sub_resp, Exception) and getattr(sub_resp, "status_code", None) == 200:
                for sub in sub_resp.json().get("studentSubmissions", []):
                    cw_id = sub.get("courseWorkId")
                    if cw_id:
                        course_student_cw_ids[course_id].add(cw_id)
                        sub_st = sub.get("state") or "NEW"
                        assigned_grade = sub.get("assignedGrade")
                        draft_grade = sub.get("draftGrade")
                        grade_val = assigned_grade if assigned_grade is not None else draft_grade
                        submissions_by_cw_id[cw_id] = {
                            "state": sub_st,
                            "grade": grade_val,
                        }
                        # TURNED_IN = здано студентом, RETURNED = повернуто викладачем (оцінено)
                        if sub_st in ("TURNED_IN", "RETURNED"):
                            turned_in_cw_ids.add(cw_id)

            if not isinstance(top_resp, Exception) and top_resp.status_code == 200:
                for top in top_resp.json().get("topic", []):
                    t_id, t_name = top.get("topicId"), top.get("name")
                    if t_id and t_name:
                        topics_by_id[t_id] = t_name
            topics_by_course[course_id] = topics_by_id

            if not isinstance(t_resp, Exception) and t_resp.status_code == 200:
                raw_teachers = t_resp.json().get("teachers", [])
                course_teacher_count[course_id] = len(raw_teachers)
                is_single_teacher_course = len(raw_teachers) <= 1

                for t_item in raw_teachers:
                    uid = t_item.get("userId")
                    prof = t_item.get("profile", {})
                    fn = prof.get("name", {}).get("fullName", "").strip()
                    email = prof.get("emailAddress")
                    if fn:
                        t_toks = [w for w in _norm(fn).split() if len(w) >= 3]

                        parts = [p for p in fn.split() if len(p) > 2]
                        matched_db_t = None
                        for part in parts:
                            part_low = part.lower()
                            matched_db_t = next(
                                (dbt for dbt in db_teachers if part_low in dbt.name.lower()),
                                None,
                            )
                            if matched_db_t:
                                if not matched_db_t.full_name:
                                    matched_db_t.full_name = fn[:150]
                                if email and not matched_db_t.email:
                                    matched_db_t.email = email[:255]
                                break

                        if matched_db_t:
                            db_first = _norm(matched_db_t.name.split()[0])
                            if db_first and db_first not in t_toks:
                                t_toks.append(db_first)
                            t_display_name = matched_db_t.name
                        else:
                            t_display_name = fn

                        if uid:
                            teacher_tokens_by_uid[uid] = t_toks
                            if t_display_name:
                                teacher_name_by_uid[uid] = t_display_name
                            course_teacher_uids[course_id].append(uid)

                        course_teachers_tokens[course_id].extend(t_toks)

                        # Для курсу з 1 викладачем одразу додаємо його до персональних викладачів студента.
                        # Для спільного курсу з 2+ викладачами (напр. Токарєва + Хочинська в одному курсі)
                        # викладача студента визначаємо нижче за фактичними публікаціями (creatorUserId),
                        # які адресовані цьому студенту!
                        if is_single_teacher_course:
                            synced_teacher_tokens.update(t_toks)
                            if t_display_name:
                                synced_teacher_names.add(t_display_name)

            if not isinstance(ann_resp, Exception) and ann_resp.status_code == 200:
                for ann in ann_resp.json().get("announcements", []):
                    cid = ann.get("creatorUserId", "")
                    if cid and cid not in teacher_tokens_by_uid:
                        missing_creators.add((course_id, cid))

            if not isinstance(cw_resp, Exception) and cw_resp.status_code == 200:
                for cw in cw_resp.json().get("courseWork", []):
                    cid = cw.get("creatorUserId", "")
                    if cid and cid not in teacher_tokens_by_uid:
                        missing_creators.add((course_id, cid))

            if not isinstance(mat_resp, Exception) and mat_resp.status_code == 200:
                for mat in mat_resp.json().get("courseWorkMaterial", []):
                    cid = mat.get("creatorUserId", "")
                    if cid and cid not in teacher_tokens_by_uid:
                        missing_creators.add((course_id, cid))

        # Оптимізація 1.1: Завантажуємо всі відсутні профілі викладачів ОДНИМ паралельним пакетом
        if missing_creators:
            async def _fetch_missing_creator(c_id: str, u_id: str):
                async with sem:
                    try:
                        r = await client.get(
                            f"https://classroom.googleapis.com/v1/courses/{c_id}/teachers/{u_id}",
                            headers=headers,
                        )
                        if r.status_code == 200:
                            raw_fn = r.json().get("profile", {}).get("name", {}).get("fullName", "").strip()
                            fn = _norm(raw_fn)
                            return u_id, raw_fn, [w for w in fn.split() if len(w) >= 3]
                    except Exception:
                        pass
                    return u_id, "", []

            fetched_profiles = await asyncio.gather(
                *(_fetch_missing_creator(c_id, u_id) for c_id, u_id in missing_creators)
            )
            for u_id, raw_fn, toks in fetched_profiles:
                if toks or u_id not in teacher_tokens_by_uid:
                    teacher_tokens_by_uid[u_id] = toks
                if raw_fn and u_id not in teacher_name_by_uid:
                    matched_db_t = next(
                        (dbt for dbt in db_teachers if any(tok in dbt.name.lower() for tok in toks)),
                        None,
                    )
                    teacher_name_by_uid[u_id] = matched_db_t.name if matched_db_t else raw_fn

        # Для спільних курсів з кількома викладачами (course_teacher_count > 1) визначаємо викладача
        # підгрупи цього студента за автором (creatorUserId) видимих для нього оголошень і завдань.
        for course, bundle_items in bundles:
            if len(bundle_items) < 5:
                continue
            course_id = course["id"]
            if course_teacher_count.get(course_id, 0) <= 1:
                continue

            ann_resp = bundle_items[1]
            cw_resp = bundle_items[2]
            mat_resp = bundle_items[4]
            creator_counts: dict[str, int] = {}

            if not isinstance(ann_resp, Exception) and ann_resp.status_code == 200:
                for ann in ann_resp.json().get("announcements", []):
                    cid = ann.get("creatorUserId", "")
                    if cid and teacher_tokens_by_uid.get(cid):
                        creator_counts[cid] = creator_counts.get(cid, 0) + 1

            if not isinstance(cw_resp, Exception) and cw_resp.status_code == 200:
                for cw in cw_resp.json().get("courseWork", []):
                    cid = cw.get("creatorUserId", "")
                    if cid and teacher_tokens_by_uid.get(cid):
                        creator_counts[cid] = creator_counts.get(cid, 0) + 1

            if not isinstance(mat_resp, Exception) and mat_resp.status_code == 200:
                for mat in mat_resp.json().get("courseWorkMaterial", []):
                    cid = mat.get("creatorUserId", "")
                    if cid and teacher_tokens_by_uid.get(cid):
                        creator_counts[cid] = creator_counts.get(cid, 0) + 1

            if creator_counts:
                dominant_uid = max(creator_counts.items(), key=lambda kv: kv[1])[0]
                student_dominant_uid_by_course[course_id] = dominant_uid
                synced_teacher_tokens.update(teacher_tokens_by_uid.get(dominant_uid, []))
                if dominant_uid in teacher_name_by_uid:
                    synced_teacher_names.add(teacher_name_by_uid[dominant_uid])

        # Динамічно визначаємо підгрупи студента (1 або 2) за викладачами в парах розкладу з поділом на підгрупи:
        for d_lessons in horizon_lessons_by_date.values():
            for l in d_lessons:
                if getattr(l, "second_teacher_id", None) or ("/" in (getattr(l, "teacher_name", "") or "")):
                    t_names = [t.strip() for t in (getattr(l, "teacher_name", "") or "").split("/") if t.strip()]
                    t1_surname = t_names[0].split()[0].strip() if len(t_names) > 0 else ""
                    t2_surname = t_names[1].split()[0].strip() if len(t_names) > 1 else ""

                    t1_folded = _fold(t1_surname)
                    t2_folded = _fold(t2_surname)

                    m1 = any(t1_folded in tok or (len(tok) >= 4 and tok in t1_folded) for tok in synced_teacher_tokens if len(tok) >= 3) if t1_folded else False
                    m2 = any(t2_folded in tok or (len(tok) >= 4 and tok in t2_folded) for tok in synced_teacher_tokens if len(tok) >= 3) if t2_folded else False

                    if m1 and not m2:
                        synced_subgroups.add(1)
                    elif m2 and not m1:
                        synced_subgroups.add(2)

        # Також перевіряємо назви курсів Classroom на наявність явних позначок підгруп
        for c in courses:
            c_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
            c_fold = _fold(c_title)
            if any(k in c_fold for k in ("1підгр", "1group", "1підгрупа", "підгрупа1")):
                synced_subgroups.add(1)
            if any(k in c_fold for k in ("2підгр", "2group", "2підгрупа", "підгрупа2")):
                synced_subgroups.add(2)

        # Прохід 2: Миттєва обробка оголошень, матеріалів та ДЗ у пам'яті без жодного HTTP-запиту
        for course, bundle_items in bundles:
            if len(bundle_items) < 5:
                continue
            ann_resp = bundle_items[1]
            cw_resp = bundle_items[2]
            mat_resp = bundle_items[4]
            course_id = course["id"]
            course_title = f"{course.get('name', '')} {course.get('section', '')}".strip()
            course_title_norm = _norm(course_title)
            topics_by_id = topics_by_course.get(course_id, {})
            is_single_teacher = course_teacher_count.get(course_id, 0) <= 1
            dominant_uid = student_dominant_uid_by_course.get(course_id)

            # 2.0. Посилання з заголовку/опису/кімнати курсу
            course_header_text = f"{course.get('descriptionHeading', '')} {course.get('description', '')} {course.get('room', '')}".strip()
            if ONLINE_HINT_RE.search(course_header_text) or URL_RE.search(course_header_text):
                parsed = _parse_announcement(course_header_text, now_kyiv, None)
                if parsed:
                    parsed["has_explicit_date"] = False
                    parsed["is_course_level"] = True
                    parsed["course_title_norm"] = course_title_norm
                    header_tokens = (
                        teacher_tokens_by_uid.get(dominant_uid, [])
                        if dominant_uid
                        else course_teachers_tokens.get(course_id, [])
                    )
                    parsed["author_tokens"] = list(set(header_tokens))
                    parsed_announcements.append(parsed)

            if not isinstance(ann_resp, Exception) and ann_resp.status_code == 200:
                for ann in ann_resp.json().get("announcements", []):
                    text = ann.get("text", "")
                    if not text:
                        continue
                    created_raw = ann.get("creationTime") or ann.get("updateTime")
                    created_dt = (
                        datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(KYIV_TZ)
                        if created_raw
                        else now_kyiv
                    )
                    parsed = _parse_announcement(text, created_dt, ann.get("materials"))
                    if not parsed:
                        continue

                    creator_id = ann.get("creatorUserId", "")
                    ann_author_tokens = list(teacher_tokens_by_uid.get(creator_id, []))
                    if not ann_author_tokens and is_single_teacher:
                        ann_author_tokens.extend(course_teachers_tokens.get(course_id, []))

                    parsed["course_title_norm"] = course_title_norm
                    parsed["author_tokens"] = list(set(ann_author_tokens))
                    parsed_announcements.append(parsed)

            if not isinstance(mat_resp, Exception) and mat_resp.status_code == 200:
                for mat in mat_resp.json().get("courseWorkMaterial", []):
                    text = f"{mat.get('title', '')}\n{mat.get('description', '')}".strip()
                    if not text and not mat.get("materials"):
                        continue
                    created_raw = mat.get("creationTime") or mat.get("updateTime")
                    created_dt = (
                        datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(KYIV_TZ)
                        if created_raw
                        else now_kyiv
                    )
                    parsed = _parse_announcement(text, created_dt, mat.get("materials"))
                    if not parsed:
                        continue

                    creator_id = mat.get("creatorUserId", "")
                    mat_author_tokens = list(teacher_tokens_by_uid.get(creator_id, []))
                    if not mat_author_tokens and is_single_teacher:
                        mat_author_tokens.extend(course_teachers_tokens.get(course_id, []))

                    parsed["course_title_norm"] = course_title_norm
                    parsed["author_tokens"] = list(set(mat_author_tokens))
                    parsed_announcements.append(parsed)

            if not isinstance(cw_resp, Exception) and cw_resp.status_code == 200:
                for cw in cw_resp.json().get("courseWork", []):
                    cw_id = cw.get("id")
                    alt_link = (cw.get("alternateLink") or "").strip()
                    if not alt_link or not cw_id:
                        continue

                    created_raw = cw.get("creationTime") or cw.get("updateTime")
                    created_dt = (
                        datetime.fromisoformat(created_raw.replace("Z", "+00:00")).astimezone(KYIV_TZ)
                        if created_raw
                        else now_kyiv
                    )

                    due = cw.get("dueDate")
                    due_date: Optional[date] = None
                    if due and due.get("year") and due.get("month") and due.get("day"):
                        try:
                            due_date = date(int(due["year"]), int(due["month"]), int(due["day"]))
                        except ValueError:
                            due_date = None

                    title_raw = re.sub(r"\s+", " ", (cw.get("title") or "").replace("|", "/")).strip() or "Без назви"
                    title_norm = _norm(title_raw)
                    max_points = cw.get("maxPoints")

                    sub_data = submissions_by_cw_id.get(cw_id)
                    if sub_data:
                        cw_state = sub_data.get("state") or "NEW"
                        assigned_grade = sub_data.get("grade")
                    else:
                        cw_state = "UNKNOWN" if has_submission_scope_error else "NEW"
                        assigned_grade = None

                    course_cw_total[course_id] = course_cw_total.get(course_id, 0) + 1
                    is_turned_in = cw_id in turned_in_cw_ids or cw_state in ("TURNED_IN", "RETURNED")
                    if not is_turned_in:
                        course_cw_active[course_id] = course_cw_active.get(course_id, 0) + 1

                    creator_id = cw.get("creatorUserId", "")
                    topic_name = topics_by_id.get(cw.get("topicId"), "")
                    topic_norm = _norm(topic_name)

                    task_author_tokens = list(teacher_tokens_by_uid.get(creator_id, []))
                    if not task_author_tokens and is_single_teacher:
                        task_author_tokens.extend(course_teachers_tokens.get(course_id, []))

                    matched_teacher_name = teacher_name_by_uid.get(creator_id)
                    for dbt in db_teachers:
                        clean_t_surname = _norm(dbt.name.split()[0])
                        if len(clean_t_surname) >= 3 and (
                            clean_t_surname in topic_norm
                            or any(clean_t_surname in tok or tok in clean_t_surname for tok in task_author_tokens)
                        ):
                            if clean_t_surname not in task_author_tokens:
                                task_author_tokens.append(clean_t_surname)
                            if not matched_teacher_name:
                                matched_teacher_name = dbt.name

                    if not matched_teacher_name and is_single_teacher:
                        c_uids = course_teacher_uids.get(course_id, [])
                        for cu in c_uids:
                            if teacher_name_by_uid.get(cu):
                                matched_teacher_name = teacher_name_by_uid[cu]
                                break

                    if not matched_teacher_name:
                        for dbt in db_teachers:
                            clean_t_surname = _norm(dbt.name.split()[0])
                            if len(clean_t_surname) >= 3 and (
                                clean_t_surname in course_title_norm
                                or clean_t_surname in title_norm
                            ):
                                matched_teacher_name = dbt.name
                                break

                    resolved_t_name = matched_teacher_name
                    if not resolved_t_name and task_author_tokens:
                        first_tok = task_author_tokens[0].lower()
                        dbt_match = next((dbt for dbt in db_teachers if first_tok in dbt.name.lower()), None)
                        resolved_t_name = dbt_match.name if dbt_match else None

                    combined_cw_text = f"{topic_norm} {title_norm} {course_title_norm}".strip()

                    course_clean = re.sub(
                        r"\s*[\(\[]\s*(?:гр(?:упа|\.)?\s*)?\d{1,3}[\s\-_–—]?(?:[А-Яа-яA-Za-z]+)?\s*[\)\]]",
                        "",
                        course_title,
                        flags=re.IGNORECASE,
                    ).strip()
                    initial_subj = course_clean or course.get("name", "") or course_title
                    for d_lessons in horizon_lessons_by_date.values():
                        matched_l = next(
                            (
                                l_obj for l_obj in d_lessons
                                if getattr(l_obj, "subject_name", None)
                                and _matches_lesson(l_obj, combined_cw_text, "", task_author_tokens)
                            ),
                            None,
                        )
                        if matched_l:
                            initial_subj = matched_l.subject_name
                            break

                    task_entry = {
                        "id": cw_id,
                        "course_id": course_id,
                        "course_name": initial_subj,
                        "title": title_raw,
                        "subject": initial_subj,
                        "teacher": resolved_t_name or None,
                        "due_date": due_date.isoformat() if due_date else None,
                        "created_at": created_dt.isoformat(),
                        "creation_time": created_dt.isoformat(),
                        "url": alt_link,
                        "alternate_link": alt_link,
                        "state": cw_state,
                        "grade": assigned_grade,
                        "max_points": max_points,
                    }
                    all_classroom_tasks.append(task_entry)

                    assigned_cws = course_student_cw_ids.get(course_id)
                    # Якщо у цьому курсі Google Classroom повернув studentSubmissions:
                    # показуємо всі завдання, які є в Classroom цього студента (userId="me"), незалежно від підгрупи.
                    is_assigned_to_student = True
                    if assigned_cws:
                        is_assigned_to_student = cw_id in assigned_cws

                    if is_assigned_to_student:
                        personal_classroom_tasks.append(task_entry)

                    # 13.3: Усі опубліковані завдання записуються в загальну базу розкладу групи,
                    # щоб не прив'язані користувачі бачили все з наявними правилами розкладу.
                    # 25.6: Персональний стан здачі (TURNED_IN, RETURNED, оцінки) НЕ впливає на спільні нотатки групи!
                    if due_date is not None:
                        if due_date > tasks_window_end:
                            unmapped_tasks.append({
                                "title": title_raw,
                                "due_date": due_date.isoformat(),
                                "reason": f"Дедлайн за межами горизонту розкладу ({due_date.strftime('%d.%m')})",
                            })
                            continue

                    raw_coursework_items.append({
                        "due_date": due_date,
                        "created_dt": created_dt,
                        "alt_link": alt_link,
                        "title_raw": title_raw,
                        "title_norm": title_norm,
                        "topic_norm": topic_norm,
                        "course_title_norm": course_title_norm,
                        "combined_text": combined_cw_text,
                        "author_tokens": list(set(task_author_tokens)),
                        "task_entry": task_entry,
                    })

    # КРОК 1b: Smart Merge для старих [TASK] та посилань Meet/Zoom.
    # Тепер відомо, які саме викладачі є активними для цього студента (synced_teacher_tokens),
    # тож оновлюємо/очищуємо лише ЇХНІ рядки, а посилання та ДЗ викладача іншої підгрупи зберігаємо!
    sync_teacher_tokens = set(synced_teacher_tokens)
    synced_subject_ids: set[int] = set()
    for course, _ in bundles:
        c_id = course["id"]
        c_title_norm = _norm(f"{course.get('name', '')} {course.get('section', '')}".strip())
        c_toks = course_teachers_tokens.get(c_id, [])
        for d_lessons in horizon_lessons_by_date.values():
            for l_obj in d_lessons:
                if getattr(l_obj, "subject_id", None) and _matches_lesson(l_obj, c_title_norm, "", c_toks):
                    synced_subject_ids.add(l_obj.subject_id)

    # Попередньо визначаємо слоти, для яких є актуальні посилання у вікні синхронізації (попередні 2 тижні + поточний тиждень)
    parsed_announcements.sort(key=lambda x: x["created_dt"])
    planned_link_attachments: list[tuple[date, object, str, Optional[str]]] = []
    replaced_link_slots: set[tuple[date, int]] = set()

    for pa in parsed_announcements:
        target_date: date = pa["target_date"]
        has_explicit_date: bool = pa.get("has_explicit_date", False)
        is_course_level: bool = pa.get("is_course_level", False)
        course_title_norm_pa: str = pa.get("course_title_norm", "")
        text_norm_pa: str = pa["text_norm"]
        author_tokens_pa: list[str] = pa.get("author_tokens", [])

        if has_explicit_date:
            candidate_dates = [target_date] if (links_window_start <= target_date <= links_window_end) else []
        elif is_course_level:
            candidate_dates = [
                d for d in sorted(horizon_lessons_by_date.keys())
                if links_window_start <= d <= links_window_end
            ]
        else:
            # Оголошення без явної дати прив'язується у межах тижня публікації (links_window_start..links_window_end).
            # Якщо в сам день публікації пари цього предмета немає (або вона вже закінчилася),
            # шукаємо найближчу пару цього предмета в межах ТОГО САМОГО тижня (понеділок–п'ятниця).
            if links_window_start <= target_date <= links_window_end:
                same_day_lessons = [
                    l for l in horizon_lessons_by_date.get(target_date, [])
                    if _matches_lesson(l, course_title_norm_pa, text_norm_pa, author_tokens_pa)
                ]
                created_dt_pa: datetime = pa["created_dt"]
                created_mins_pa = created_dt_pa.hour * 60 + created_dt_pa.minute
                posted_after_same_day_lesson = (
                    bool(same_day_lessons)
                    and target_date == created_dt_pa.date()
                    and all(
                        BELL_END_MINUTES.get(getattr(l, "lesson_number", 0), 15 * 60) <= created_mins_pa
                        for l in same_day_lessons
                    )
                )
                if same_day_lessons and not posted_after_same_day_lesson:
                    candidate_dates = [target_date]
                else:
                    ann_monday = target_date - timedelta(days=target_date.weekday())
                    ann_friday = min(ann_monday + timedelta(days=4), links_window_end)
                    week_matching_dates = [
                        d for d in sorted(horizon_lessons_by_date.keys())
                        if max(ann_monday, links_window_start) <= d <= ann_friday
                        and any(
                            _matches_lesson(l, course_title_norm_pa, text_norm_pa, author_tokens_pa)
                            for l in horizon_lessons_by_date.get(d, [])
                        )
                    ]
                    upcoming_in_week = [d for d in week_matching_dates if d > target_date]
                    if upcoming_in_week:
                        candidate_dates = [upcoming_in_week[0]]
                    elif same_day_lessons:
                        candidate_dates = [target_date]
                    elif week_matching_dates:
                        candidate_dates = [week_matching_dates[-1]]
                    else:
                        candidate_dates = []
            else:
                candidate_dates = []

        for c_date in candidate_dates:
            day_lessons = horizon_lessons_by_date.get(c_date, [])
            if not day_lessons:
                continue

            candidates = [
                l for l in day_lessons
                if _matches_lesson(l, course_title_norm_pa, text_norm_pa, author_tokens_pa)
            ]
            matched_lessons = []

            if pa["lesson_number"] is not None:
                matched_lessons = [l for l in candidates if l.lesson_number == pa["lesson_number"]]
                if not matched_lessons and not candidates and has_explicit_date and c_date == target_date:
                    fallback_l = next(
                        (l for l in day_lessons if l.lesson_number == pa["lesson_number"]),
                        None,
                    )
                    if fallback_l:
                        matched_lessons = [fallback_l]
            elif candidates:
                matched_lessons = candidates

            if not matched_lessons:
                continue

            for matched_lesson in matched_lessons:
                url_line = pa["url"]
                combined_ann = f"{course_title_norm_pa} {text_norm_pa}".strip()
                matched_prefix = _resolve_matched_teacher_surname(
                    matched_lesson, author_tokens_pa, combined_ann, db_teachers
                )
                if matched_prefix:
                    url_line = f"{matched_prefix}: {url_line}"
                planned_link_attachments.append((c_date, matched_lesson, url_line, matched_prefix))
                if getattr(matched_lesson, "lesson_number", None):
                    replaced_link_slots.add((c_date, matched_lesson.lesson_number))

    for gn in all_group_notes:
        if gn.archived:
            continue
        kept: list[str] = []
        changed = False
        for line in gn.note.split("\n"):
            l_str = line.strip()
            if not l_str:
                continue
            if l_str.startswith("[TASK"):
                c_match = re.search(r"/(?:c|w)/([A-Za-z0-9_\-]+)", l_str)
                task_c_id = c_match.group(1) if c_match else None
                if _task_line_belongs_to_sync(
                    l_str, task_c_id, current_sync_course_ids, sync_teacher_tokens, synced_subgroups
                ):
                    changed = True
                    continue
                kept.append(l_str)
                continue
            if (
                URL_RE.search(l_str)
                and _link_line_belongs_to_sync(l_str, sync_teacher_tokens, synced_subgroups)
            ):
                # Ніколи не видаляємо посилання з історичних тижнів за межами вікна синхронізації,
                # з предметів поза поточним синком, або зі слотів, де немає нового посилання на заміну
                if (
                    gn.note_date < links_window_start
                    or gn.note_date > links_window_end
                    or gn.subject_id not in synced_subject_ids
                    or (gn.note_date, gn.lesson_number) not in replaced_link_slots
                ):
                    kept.append(l_str)
                    continue
                changed = True
                continue
            kept.append(l_str)
        if changed:
            if kept:
                gn.note = "\n".join(kept)
            else:
                gn.archived = True
            gn.revision += 1
            gn.updated_at = datetime.now(timezone.utc)
    await db.flush()

    notes_by_slot: dict[tuple[date, int], LessonOccurrenceNote] = {}
    for gn in all_group_notes_all:
        slot_k = (gn.note_date, gn.lesson_number)
        prev = notes_by_slot.get(slot_k)
        if prev is None or (prev.archived and not gn.archived) or (prev.archived == gn.archived):
            notes_by_slot[slot_k] = gn

    # КРОК 4: Прикріплюємо ДЗ (за правилами 13.1, 13.2 та 13.3)
    sorted_horizon_dates = sorted(
        d for d in horizon_lessons_by_date.keys()
        if tasks_lookback_start <= d <= tasks_window_end
    )

    # 13.3: Сортування завдань перед прив'язкою: спочатку з датою (за зростанням дедлайну), потім без дати (за датою публікації)
    raw_coursework_items.sort(
        key=lambda x: (
            0 if x["due_date"] is not None else 1,
            x["due_date"] or date.min,
            x["created_dt"],
        )
    )

    for cw_item in raw_coursework_items:
        due_date: Optional[date] = cw_item["due_date"]
        created_dt: datetime = cw_item["created_dt"]
        alt_link: str = cw_item["alt_link"]
        combined_cw_text = cw_item["combined_text"]
        author_tokens = cw_item["author_tokens"]

        target_date_for_task: Optional[date] = None
        target_lesson = None

        if due_date is not None:
            # 13.1 Завдання з датою здачі:
            # • Завдання прив'язується до пари того самого предмета і викладача в тижні, який містить дату здачі.
            due_monday = due_date - timedelta(days=due_date.weekday())
            due_friday = due_monday + timedelta(days=4)

            week_candidates = [
                (d, l)
                for d in sorted_horizon_dates
                if due_monday <= d <= due_friday and d in horizon_lessons_by_date
                for l in horizon_lessons_by_date[d]
                if _matches_lesson(l, combined_cw_text, "", author_tokens)
            ]

            if week_candidates:
                # • Якщо в цьому тижні кілька пар предмета, береться найближча пара в день здачі або після нього;
                after_or_on_due = [c for c in week_candidates if c[0] >= due_date]
                if after_or_on_due:
                    target_date_for_task, target_lesson = after_or_on_due[0]
                else:
                    # якщо таких немає, то остання пара до дати здачі.
                    target_date_for_task, target_lesson = week_candidates[-1]
            else:
                # • Якщо в тижні дати здачі пари предмета немає, завдання прив'язується до першої наступної пари цього предмета після дати здачі.
                next_candidates = [
                    (d, l)
                    for d in sorted_horizon_dates
                    if d > due_friday and d in horizon_lessons_by_date
                    for l in horizon_lessons_by_date[d]
                    if _matches_lesson(l, combined_cw_text, "", author_tokens)
                ]
                if next_candidates:
                    target_date_for_task, target_lesson = next_candidates[0]
        else:
            # 13.2 Завдання без дати здачі:
            # • Прив'язується до першої пари предмета після дати публікації завдання (creationTime з Classroom).
            created_date = created_dt.date()
            created_mins = created_dt.hour * 60 + created_dt.minute

            for d_candidate in sorted_horizon_dates:
                if d_candidate < created_date:
                    continue
                day_matches = [
                    l for l in horizon_lessons_by_date.get(d_candidate, [])
                    if _matches_lesson(l, combined_cw_text, "", author_tokens)
                ]
                if not day_matches:
                    continue

                if d_candidate == created_date:
                    after_creation = [
                        l for l in day_matches
                        if BELL_END_MINUTES.get(l.lesson_number, 15 * 60) > created_mins
                    ]
                    if after_creation:
                        target_lesson = after_creation[0]
                        target_date_for_task = d_candidate
                        break
                else:
                    target_lesson = day_matches[0]
                    target_date_for_task = d_candidate
                    break

        if not target_lesson or not target_date_for_task:
            unmapped_tasks.append({
                "title": cw_item.get("title_raw", "Без назви"),
                "due_date": due_date.isoformat() if due_date else None,
                "reason": "Не знайдено відповідної пари в розкладі (предмет або викладач не збіглися)",
            })
            continue

        if target_lesson and getattr(target_lesson, "subject_name", None) and cw_item.get("task_entry"):
            cw_item["task_entry"]["subject"] = target_lesson.subject_name
            cw_item["task_entry"]["course_name"] = target_lesson.subject_name

        teacher_badge = _resolve_matched_teacher_surname(
            target_lesson, author_tokens, combined_cw_text, db_teachers
        )

        task_title = (cw_item.get("title_raw") or "").strip() or "Домашнє завдання"
        # 13.2: Для завдань без дати здачі не показується жодна дата. Лише назва, предмет, викладач і посилання.
        label_text = (
            f"{task_title} (до {due_date.strftime('%d.%m')})"
            if due_date is not None
            else task_title
        )

        max_pts = cw_item.get("task_entry", {}).get("max_points")
        pts_suffix = ""
        if max_pts is not None:
            pts_val = int(max_pts) if isinstance(max_pts, (int, float)) and float(max_pts).is_integer() else max_pts
            pts_suffix = f" | max_points={pts_val}"

        if teacher_badge:
            task_line = f"[TASK] [{teacher_badge}] {label_text} | {alt_link[:250]}{pts_suffix}"
        else:
            task_line = f"[TASK] {label_text} | {alt_link[:250]}{pts_suffix}"

        added = await _upsert_task_line(
            db=db,
            target_date=target_date_for_task,
            group_id=group.id,
            lesson=target_lesson,
            task_line=task_line,
            unique_link=alt_link,
            notes_by_slot=notes_by_slot,
        )
        if added:
            synced_tasks += 1

    # Очищуємо застарілі примітки [TASKS_COMPLETED], оскільки стан здачі є персональним
    # лише для студента, який прив'язав свою пошту в браузері
    for note_obj in list(notes_by_slot.values()):
        if not note_obj.archived and "[TASKS_COMPLETED]" in (note_obj.note or ""):
            cleaned_lines = [l for l in note_obj.note.split("\n") if l.strip() and not l.strip().startswith("[TASKS_COMPLETED]")]
            if cleaned_lines:
                note_obj.note = "\n".join(cleaned_lines)
                note_obj.revision += 1
            else:
                note_obj.archived = True
                note_obj.revision += 1

    # КРОК 5: Ставимо розпізнані посилання Meet / Zoom на відповідні пари у вікні синхронізації (links_window_start..links_window_end)
    for c_date, matched_lesson, url_line, matched_prefix in planned_link_attachments:
        await _save_link_to_slot(
            db, c_date, group.id, matched_lesson, url_line, matched_prefix, notes_by_slot=notes_by_slot
        )
        synced_links += 1

    await db.flush()

    _latest_unmapped_tasks[group.id] = unmapped_tasks

    # Smart Merge: зберігаємо завдання курсів інших підгруп (у т.ч. зі спільного курсу з 2 викладачами)
    existing_tasks = _latest_group_tasks.get(group.id, [])
    folded_sync_tokens = {_fold(tok) for tok in sync_teacher_tokens if tok}

    def _should_preserve_task(t: dict) -> bool:
        t_cid = str(t.get("course_id") or "")
        if t_cid not in current_sync_course_ids:
            return True
        t_teacher = str(t.get("teacher") or "").strip()
        if t_teacher and folded_sync_tokens:
            p = _fold(t_teacher.split()[0])
            if len(p) >= 3:
                matches_current = any(
                    p in tok or (len(tok) >= 4 and tok in p) for tok in folded_sync_tokens
                )
                if not matches_current:
                    return True
        return False

    preserved_tasks = [t for t in existing_tasks if _should_preserve_task(t)]
    new_group_tasks = [
        {**t, "state": "NEW", "grade": None}
        for t in all_classroom_tasks
    ]
    seen_task_keys = set()
    combined_tasks: list[dict] = []
    for t in new_group_tasks:
        k = str(t.get("url") or t.get("alternate_link") or t.get("id") or "")
        if k:
            seen_task_keys.add(k)
        combined_tasks.append(t)
    for pt in preserved_tasks:
        k = str(pt.get("url") or pt.get("alternate_link") or pt.get("id") or "")
        if k and k in seen_task_keys:
            continue
        if k:
            seen_task_keys.add(k)
        combined_tasks.append(pt)

    if skip_course_ids and group.id in _latest_group_tasks:
        # Якщо частина курсів була пропущена через дедуплікацію між акаунтами групи,
        # об'єднуємо нові завдання з уже збереженими завданнями інших курсів!
        merged_by_key: dict[str, dict] = {}
        for existing_t in _latest_group_tasks.get(group.id, []):
            k = existing_t.get("url") or existing_t.get("alternate_link") or existing_t.get("id")
            if k:
                merged_by_key[str(k)] = existing_t
        for new_t in combined_tasks:
            k = new_t.get("url") or new_t.get("alternate_link") or new_t.get("id")
            if k:
                merged_by_key[str(k)] = new_t
        _latest_group_tasks[group.id] = list(merged_by_key.values())
    elif combined_tasks or group.id not in _latest_group_tasks:
        _latest_group_tasks[group.id] = combined_tasks
    _latest_scope_missing[group.id] = has_submission_scope_error

    for tok in synced_teacher_tokens:
        if "токар" in tok:
            synced_subgroups.add(1)
        elif "хочин" in tok:
            synced_subgroups.add(2)

    deduplicable_course_ids = [
        cid for cid in current_sync_course_ids
        if course_teacher_count.get(cid, 0) <= 1
    ]

    return {
        "user_email": user_email,
        "google_user_id": google_user_id,
        "synced_course_ids": list(current_sync_course_ids),
        "deduplicable_course_ids": deduplicable_course_ids,
        "synced_teacher_names": sorted(list(synced_teacher_names)),
        "synced_teacher_tokens": sorted(list(synced_teacher_tokens)),
        "synced_subgroups": sorted(list(synced_subgroups)),
        "synced_links": synced_links,
        "synced_tasks": synced_tasks,
        "synced_students": synced_students,
        "unmapped_tasks": unmapped_tasks,
        "tasks": combined_tasks,
        "personal_tasks": personal_classroom_tasks,
        "needs_reconnect": has_submission_scope_error,
    }


async def sync_classroom_account_flow(
    payload: ClassroomSyncRequest,
    db: AsyncSession,
) -> dict:
    try:
        access_token = payload.access_token
        refresh_token = payload.refresh_token
        granted_scope_str: Optional[str] = None
        code_exchanged = False

        if payload.code:
            code_exchanged = True
            client_id = classroom_tokens.get_google_client_id()
            client_secret = classroom_tokens.get_google_client_secret()
            if not client_id or not client_secret:
                logger.warning("Google OAuth code exchange requested, but GOOGLE_CLIENT_SECRET is missing in backend settings.")
                raise HTTPException(
                    status_code=400,
                    detail="GOOGLE_CLIENT_SECRET не налаштовано на сервері для отримання refresh_token. Використайте пряму синхронізацію або додайте GOOGLE_CLIENT_SECRET у змінні середовища.",
                )
            async with httpx.AsyncClient(timeout=10.0) as client:
                token_resp = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": payload.code,
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "redirect_uri": "postmessage",
                        "grant_type": "authorization_code",
                    },
                )
                if token_resp.status_code == 200:
                    token_data = token_resp.json()
                    access_token = token_data.get("access_token")
                    refresh_token = token_data.get("refresh_token") or refresh_token
                    granted_scope_str = token_data.get("scope") or ""
                    if granted_scope_str:
                        missing_required = [s for s in REQUIRED_CLASSROOM_SCOPES if s not in granted_scope_str]
                        if missing_required:
                            logger.warning(
                                "Classroom code exchange missing required course scope in scope string: %s (missing: %s). Will verify with Classroom API.",
                                granted_scope_str,
                                missing_required,
                            )
                        missing_recommended = [s for s in RECOMMENDED_CLASSROOM_SCOPES if s not in granted_scope_str]
                        if missing_recommended:
                            logger.info(
                                "Classroom code exchange granted without optional scopes: %s",
                                missing_recommended,
                            )
                else:
                    logger.warning(
                        f"Failed to exchange code: {token_resp.status_code} {_sanitize_error_msg(token_resp.text)}"
                    )
                    raise HTTPException(
                        status_code=400,
                        detail=f"Не вдалося обміняти код авторизації Google: {_sanitize_error_msg(token_resp.text)[:200]}",
                    )

        if not access_token and refresh_token:
            access_token = await classroom_tokens._refresh_google_token(refresh_token)

        # Серверний фолбек для тихої синхронізації: якщо передано google_user_id або email без refresh_token у клієнта,
        # дістаємо зашифрований refresh_token із таблиці ClassroomCredential на сервері.
        db_lookup_cred: Optional[ClassroomCredential] = None
        refresh_permanent_error = False
        if (payload.google_user_id or payload.email) and (not access_token or not refresh_token):
            cred_q = select(ClassroomCredential)
            if payload.google_user_id:
                cred_q = cred_q.where(ClassroomCredential.google_user_id == payload.google_user_id.strip())
            elif payload.email and "@" in payload.email:
                cred_q = cred_q.where(func.lower(ClassroomCredential.email) == payload.email.strip().lower())
            if payload.group_id:
                cred_q = cred_q.where(ClassroomCredential.group_id == payload.group_id)
            cred_q = cred_q.order_by(ClassroomCredential.last_synced_at.desc().nullslast())
            db_lookup_cred = await db.scalar(cred_q)
            if not db_lookup_cred and payload.google_user_id:
                db_lookup_cred = await db.scalar(
                    select(ClassroomCredential)
                    .where(
                        ClassroomCredential.google_user_id == payload.google_user_id.strip(),
                    )
                    .order_by(ClassroomCredential.last_synced_at.desc().nullslast())
                )
            if db_lookup_cred:
                now_utc = datetime.now(timezone.utc)
                db_lookup_cred.last_client_seen_at = now_utc
                if db_lookup_cred.refresh_token:
                    if not refresh_token:
                        refresh_token = db_lookup_cred.refresh_token
                    if not access_token:
                        fresh_tok, err_detail, status_code = await classroom_tokens._refresh_google_token_detailed(db_lookup_cred.refresh_token)
                        if fresh_tok:
                            access_token = fresh_tok
                            db_lookup_cred.is_active = True
                            db_lookup_cred.needs_relink = False
                            db_lookup_cred.last_refresh_ok_at = now_utc
                            rotated = rotate_token(db_lookup_cred.refresh_token)
                            if rotated:
                                db_lookup_cred.refresh_token = rotated
                        else:
                            err_text = err_detail or f"refresh_failed_{status_code}"
                            if _is_permanent_token_error(err_text):
                                refresh_permanent_error = True
                                db_lookup_cred.needs_relink = True
                                db_lookup_cred.is_active = False
                                db_lookup_cred.last_error = f"needs_relink: {err_text}"
                            else:
                                _apply_credential_backoff(db_lookup_cred, err_text, now_utc)
                else:
                    refresh_permanent_error = True
                    db_lookup_cred.needs_relink = True
                    db_lookup_cred.is_active = False
                    db_lookup_cred.last_error = "needs_relink: missing_or_corrupt_refresh_token"
                await db.commit()

        if not access_token:
            if not payload.code and (payload.google_user_id or payload.email):
                target_gid = payload.group_id or (db_lookup_cred.group_id if db_lookup_cred else 0)
                target_gname = ""
                if target_gid:
                    grp = await db.get(Group, target_gid)
                    if grp:
                        target_gname = grp.name
                is_relink = refresh_permanent_error or not db_lookup_cred or not db_lookup_cred.refresh_token
                return {
                    "status": "needs_relink" if is_relink else "temporary_error",
                    "needs_relink": is_relink,
                    "reason_code": (
                        ("no_refresh_token" if not db_lookup_cred or not db_lookup_cred.refresh_token else "token_refresh_failed")
                        if is_relink
                        else "temporary_error"
                    ),
                    "error": (
                        "Потрібне повторне підключення до Google Classroom"
                        if is_relink
                        else "Тимчасова помилка Google під час оновлення токена"
                    ),
                    "group_id": target_gid or 0,
                    "group_name": target_gname,
                    "synced_links": 0,
                    "synced_tasks": 0,
                    "synced_students": 0,
                    "tasks": [],
                    "personal_tasks": [],
                    "unmapped_tasks": [],
                }
            raise HTTPException(status_code=400, detail="Не вдалося отримати токен доступу Google")

        headers = {"Authorization": f"Bearer {access_token}"}
        all_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()

        google_user_id: Optional[str] = None
        profile_email: Optional[str] = None
        profile_name: Optional[str] = None
        profile_photo: Optional[str] = None

        async with httpx.AsyncClient(timeout=15.0) as client:
            courses_resp = await client.get(
                "https://classroom.googleapis.com/v1/courses",
                params={"courseStates": "ACTIVE", "pageSize": 100},
                headers=headers,
            )
            if courses_resp.status_code == 401 and refresh_token:
                fresh_token, _, _ = await classroom_tokens._refresh_google_token_detailed(refresh_token)
                if fresh_token:
                    access_token = fresh_token
                    headers = {"Authorization": f"Bearer {access_token}"}
                    courses_resp = await client.get(
                        "https://classroom.googleapis.com/v1/courses",
                        params={"courseStates": "ACTIVE", "pageSize": 100},
                        headers=headers,
                    )
            if courses_resp.status_code != 200:
                is_perm = _is_permanent_courses_error(courses_resp.status_code, courses_resp.text)
                if db_lookup_cred:
                    if is_perm:
                        db_lookup_cred.needs_relink = True
                        db_lookup_cred.is_active = False
                        db_lookup_cred.last_error = f"needs_relink: courses_error_{courses_resp.status_code}"
                    else:
                        _apply_credential_backoff(
                            db_lookup_cred,
                            f"courses_error_{courses_resp.status_code}",
                            datetime.now(timezone.utc),
                        )
                    await db.commit()
                if not payload.code and (payload.google_user_id or payload.email):
                    target_gid = payload.group_id or (db_lookup_cred.group_id if db_lookup_cred else 0)
                    return {
                        "status": "needs_relink" if is_perm else "temporary_error",
                        "needs_relink": is_perm,
                        "reason_code": (
                            ("revoked" if courses_resp.status_code == 401 else "api_error")
                            if is_perm
                            else "temporary_error"
                        ),
                        "error": (
                            "Не вдалося прочитати курси з Google Classroom (потрібна повторна прив'язка)"
                            if is_perm
                            else "Google Classroom тимчасово обмежив запити — спробуйте трохи пізніше"
                        ),
                        "group_id": target_gid or 0,
                        "group_name": "",
                        "synced_links": 0,
                        "synced_tasks": 0,
                        "synced_students": 0,
                        "tasks": [],
                        "personal_tasks": [],
                        "unmapped_tasks": [],
                    }
                raise HTTPException(
                    status_code=401 if is_perm else 503,
                    detail="Не вдалося прочитати курси з Google Classroom",
                )

            courses = courses_resp.json().get("courses", [])

            # 25.4.1: Викликаємо userProfiles/me і беремо стабільний id акаунта, ім'я та пошту
            try:
                me_resp = await client.get(
                    "https://classroom.googleapis.com/v1/userProfiles/me",
                    headers=headers,
                )
                if me_resp.status_code == 200:
                    me_json = me_resp.json()
                    google_user_id = str(me_json.get("id") or "").strip() or None
                    profile_email = (me_json.get("emailAddress") or "").strip() or None
                    name_obj = me_json.get("name") or {}
                    profile_name = (name_obj.get("fullName") or "").strip() or None
                    profile_photo = (me_json.get("photoUrl") or "").strip() or None
                    if profile_photo and profile_photo.startswith("//"):
                        profile_photo = f"https:{profile_photo}"
            except Exception as exc:
                logger.warning(f"Failed to read userProfiles/me during sync: {_sanitize_error_msg(str(exc))}")

            # 1.4: Фолбек на OAuth2 userinfo, якщо userProfiles/me не повернув пошту, id, ім'я або аватарку
            if not profile_email or not google_user_id or not profile_photo or not profile_name:
                try:
                    uinfo_resp = await client.get(
                        "https://www.googleapis.com/oauth2/v3/userinfo",
                        headers=headers,
                    )
                    if uinfo_resp.status_code == 200:
                        uinfo = uinfo_resp.json()
                        profile_email = profile_email or (uinfo.get("email") or "").strip() or None
                        google_user_id = google_user_id or str(uinfo.get("sub") or "").strip() or None
                        profile_name = profile_name or (uinfo.get("name") or "").strip() or None
                        profile_photo = profile_photo or (uinfo.get("picture") or "").strip() or None
                except Exception as exc:
                    logger.warning(f"Failed to read oauth2 userinfo during sync: {_sanitize_error_msg(str(exc))}")

        courses_by_group_id: dict[int, list[tuple[Group, dict]]] = {}
        for c in courses:
            full_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
            g = _extract_group_from_course_name(full_title, all_groups)
            if g:
                courses_by_group_id.setdefault(g.id, []).append((g, c))

        detected_group: Optional[Group] = None
        matched_course = None

        if courses_by_group_id:
            sorted_by_count = sorted(
                courses_by_group_id.items(),
                key=lambda item: len(item[1]),
                reverse=True,
            )
            _, top_group_courses = sorted_by_count[0]

            # 2.1: Пріоритет поточної обраної групи студента (payload.group_id):
            # якщо в курсах є хоча б один курс цієї групи, НЕ перемикаємо студента на чужу/стару групу
            if payload.group_id and payload.group_id in courses_by_group_id:
                detected_group, matched_course = courses_by_group_id[payload.group_id][0]
            elif payload.group_id:
                req_group = next((g for g in all_groups if g.id == payload.group_id), None)
                if req_group:
                    today_k = datetime.now(KYIV_TZ).date()
                    mon_k = today_k - timedelta(days=today_k.weekday())
                    _, req_by_day = await build_week_projection(db, mon_k, group_id=req_group.id)
                    req_lessons = [
                        l_obj
                        for d_list in req_by_day.values()
                        for l_obj in d_list
                        if getattr(l_obj, "subject_id", None) and not getattr(l_obj, "is_cancelled", False)
                    ]
                    matched_for_req = None
                    for c in courses:
                        c_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
                        other_g = _extract_group_from_course_name(c_title, all_groups)
                        if other_g and other_g.id != req_group.id:
                            continue
                        c_norm = _norm(c_title)
                        if any(_matches_lesson(l_obj, c_norm, "", []) for l_obj in req_lessons):
                            matched_for_req = c
                            break
                    if matched_for_req is not None:
                        detected_group = req_group
                        matched_course = matched_for_req

            if not detected_group:
                detected_group, matched_course = top_group_courses[0]
        elif payload.group_id and courses:
            req_group = next((g for g in all_groups if g.id == payload.group_id), None)
            if req_group:
                today_k = datetime.now(KYIV_TZ).date()
                mon_k = today_k - timedelta(days=today_k.weekday())
                _, req_by_day = await build_week_projection(db, mon_k, group_id=req_group.id)
                req_lessons = [
                    l_obj
                    for d_list in req_by_day.values()
                    for l_obj in d_list
                    if getattr(l_obj, "subject_id", None) and not getattr(l_obj, "is_cancelled", False)
                ]
                for c in courses:
                    c_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
                    c_norm = _norm(c_title)
                    if any(_matches_lesson(l_obj, c_norm, "", []) for l_obj in req_lessons):
                        detected_group = req_group
                        matched_course = c
                        break

        if not detected_group:
            raise HTTPException(
                status_code=404,
                detail="Не знайдено курс вашої групи у Classroom (наприклад, КІ-24-2/9-85).",
            )

        now_utc = datetime.now(timezone.utc)
        plain_refresh = (decrypt_token(refresh_token) if refresh_token else "") or ""
        plain_refresh = plain_refresh.strip()
        if plain_refresh.startswith("ya29."):
            plain_refresh = ""

        # Якщо при повторному логіні Google не надіслав новий refresh_token,
        # підтягуємо вже збережений у БД refresh_token цього студента, щоб НЕ затерти його!
        if not plain_refresh and (google_user_id or profile_email):
            prev_cred = await db.scalar(
                select(ClassroomCredential)
                .where(
                    (ClassroomCredential.google_user_id == google_user_id)
                    if google_user_id
                    else (func.lower(ClassroomCredential.email) == profile_email.lower())
                )
                .order_by(ClassroomCredential.last_synced_at.desc().nullslast())
            )
            if prev_cred and prev_cred.refresh_token:
                cand_rt = decrypt_token(prev_cred.refresh_token) or ""
                if cand_rt and not cand_rt.startswith("ya29."):
                    plain_refresh = cand_rt

        encrypted_refresh = encrypt_token(plain_refresh) if plain_refresh else None

        binding = await db.scalar(
            select(ClassroomGroupBinding).where(ClassroomGroupBinding.group_id == detected_group.id)
        )
        group_course_id = matched_course["id"] if matched_course else (courses[0]["id"] if courses else "")
        group_course_name = matched_course.get("name", "") if matched_course else (courses[0].get("name", "") if courses else "")

        if binding is None:
            binding = ClassroomGroupBinding(
                group_id=detected_group.id,
                course_id=group_course_id[:64],
                course_name=group_course_name[:200],
                access_token=encrypt_token(access_token) if access_token else None,
                refresh_token=encrypted_refresh if encrypted_refresh else None,
                last_synced_at=now_utc,
                is_active=True,
            )
            db.add(binding)
        else:
            if group_course_id:
                binding.course_id = group_course_id[:64]
                binding.course_name = group_course_name[:200]
            binding.access_token = encrypt_token(access_token) if access_token else None
            if encrypted_refresh:
                binding.refresh_token = encrypted_refresh
            binding.last_synced_at = now_utc
            binding.is_active = True

        # Видаляємо лише дублікати прив'язки цього ж курсу до чужих груп, НЕ чіпаючи інші підключені групи!
        if len(courses_by_group_id) == 1 and group_course_id:
            await db.execute(
                delete(ClassroomGroupBinding).where(
                    ClassroomGroupBinding.group_id != detected_group.id,
                    ClassroomGroupBinding.course_id == group_course_id[:64],
                )
            )

        await db.flush()

        stats = await perform_course_sync(
            db,
            detected_group,
            courses,
            access_token,
            group_course_id=binding.course_id,
            week_start=payload.week_start,
            prefetched_user_email=profile_email,
            prefetched_google_user_id=google_user_id,
            force=True,
        )

        effective_user_id = (
            google_user_id
            or stats.get("google_user_id")
            or payload.google_user_id
            or profile_email
            or stats.get("user_email")
        )
        if not effective_user_id and plain_refresh:
            effective_user_id = f"user_{hashlib.sha256(plain_refresh.encode('utf-8')).hexdigest()[:16]}"

        # 25.4.2 & 1.2: Upsert запису в classroom_credentials за парою (group_id, google_user_id) або email.
        # Ніколи не створюємо запис ClassroomCredential із порожнім refresh_token = ""!
        cred: Optional[ClassroomCredential] = None
        if effective_user_id:
            effective_user_id = str(effective_user_id)[:128]
            final_email = profile_email or stats.get("user_email") or (payload.email if payload.email and "@" in payload.email else None)
            safe_email = final_email[:150] if final_email else None
            safe_name = profile_name[:150] if profile_name else None
            safe_photo = profile_photo[:2048] if profile_photo else None
            synced_subs = stats.get("synced_subgroups", [])
            detected_subgroup: Optional[int] = None
            if 1 in synced_subs and 2 not in synced_subs:
                detected_subgroup = 1
            elif 2 in synced_subs and 1 not in synced_subs:
                detected_subgroup = 2
            elif not synced_subs and stats.get("synced_teacher_names"):
                # Автовизначення підгрупи за викладачами двовикладацьких пар у розкладі групи
                dual_lessons = (
                    await db.scalars(
                        select(Schedule)
                        .where(
                            Schedule.group_id == detected_group.id,
                            Schedule.second_teacher_id.is_not(None),
                            Schedule.is_active.is_(True),
                        )
                    )
                ).all()
                t1_ids = {l.teacher_id for l in dual_lessons if l.teacher_id}
                t2_ids = {l.second_teacher_id for l in dual_lessons if l.second_teacher_id}
                if t1_ids or t2_ids:
                    all_t = (await db.scalars(select(Teacher).where(Teacher.id.in_(t1_ids | t2_ids)))).all()
                    t_names_by_id = {t.id: t.name.lower() for t in all_t if t.name}
                    st_names = [n.lower() for n in stats.get("synced_teacher_names", [])]
                    hits_1 = sum(1 for tid in t1_ids if any(sn.split()[0] in t_names_by_id.get(tid, "") for sn in st_names if sn))
                    hits_2 = sum(1 for tid in t2_ids if any(sn.split()[0] in t_names_by_id.get(tid, "") for sn in st_names if sn))
                    if hits_1 > 0 and hits_2 == 0:
                        detected_subgroup = 1
                    elif hits_2 > 0 and hits_1 == 0:
                        detected_subgroup = 2

            cred = await db.scalar(
                select(ClassroomCredential)
                .where(
                    ClassroomCredential.group_id == detected_group.id,
                    (ClassroomCredential.google_user_id == effective_user_id)
                    | (
                        func.lower(ClassroomCredential.email) == final_email.lower()
                        if final_email
                        else False
                    ),
                )
                .order_by(ClassroomCredential.is_active.desc(), ClassroomCredential.id.desc())
            )

            # Якщо у клієнта не прийшов новий refresh_token, зберігаємо існуючий робочий токен із БД
            if not encrypted_refresh and cred and cred.refresh_token:
                cand_rt = decrypt_token(cred.refresh_token) or ""
                if cand_rt and not cand_rt.startswith("ya29."):
                    plain_refresh = cand_rt
                    encrypted_refresh = cred.refresh_token

            if encrypted_refresh:
                if cred is None:
                    cred = ClassroomCredential(
                        group_id=detected_group.id,
                        google_user_id=effective_user_id,
                        email=safe_email,
                        student_name=safe_name,
                        photo_url=safe_photo,
                        subgroup=detected_subgroup,
                        refresh_token=encrypted_refresh,
                        last_synced_at=now_utc,
                        last_refresh_ok_at=now_utc if code_exchanged else None,
                        last_client_seen_at=now_utc,
                        granted_scopes=granted_scope_str,
                        needs_relink=False,
                        last_error=None,
                        fail_count=0,
                        next_attempt_at=None,
                        is_active=True,
                    )
                    db.add(cred)
                    await db.flush()
                else:
                    cred.google_user_id = effective_user_id
                    cred.refresh_token = encrypted_refresh
                    if safe_email:
                        cred.email = safe_email
                    if safe_name:
                        cred.student_name = safe_name
                    if safe_photo:
                        cred.photo_url = safe_photo
                    if detected_subgroup:
                        cred.subgroup = detected_subgroup
                    cred.last_synced_at = now_utc
                    cred.last_refresh_ok_at = now_utc
                    cred.last_client_seen_at = now_utc
                    cred.needs_relink = False
                    cred.last_error = None
                    cred.fail_count = 0
                    cred.next_attempt_at = None
                    cred.is_active = True
                    if granted_scope_str:
                        cred.granted_scopes = granted_scope_str
                    await db.flush()

                # Видаляємо старі дублікати цієї ж пошти в цій групі
                if final_email:
                    stale_dups = (
                        await db.scalars(
                            select(ClassroomCredential).where(
                                ClassroomCredential.group_id == detected_group.id,
                                ClassroomCredential.id != cred.id,
                                func.lower(ClassroomCredential.email) == final_email.lower(),
                            )
                        )
                    ).all()
                    for s_dup in stale_dups:
                        await db.delete(s_dup)

        detected_group.updated_at = now_utc
        await db.commit()
        from app.services import cache_rev
        cache_rev.bump([detected_group.id])

        _sync_backoff_state.pop(detected_group.id, None)

        return {
            "group_id": detected_group.id,
            "group_name": detected_group.name,
            "course_name": binding.course_name,
            "last_synced_at": binding.last_synced_at.isoformat() if binding.last_synced_at else now_utc.isoformat(),
            "access_token": access_token,
            "refresh_token": None,
            "needs_relink": bool(cred and getattr(cred, "needs_relink", False)),
            **stats,
            "google_user_id": effective_user_id,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Classroom sync error: {_sanitize_error_msg(traceback.format_exc())}")
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Помилка синхронізації Classroom: {_sanitize_error_msg(str(exc))}",
        )


async def disconnect_classroom_account_flow(
    payload: ClassroomDisconnectRequest,
    db: AsyncSession,
) -> dict:
    """
    25.6: «Від'єднати» видаляє запис цього студента з classroom_credentials
    і відкликає його токен у Google. Інші записи групи не зачіпаються.
    """
    target_user_id = (payload.google_user_id or "").strip() or None
    plain_rt = decrypt_token(payload.refresh_token) if payload.refresh_token else ""
    plain_at = decrypt_token(payload.access_token) if payload.access_token else ""

    if not target_user_id and plain_at:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                me_resp = await client.get(
                    "https://classroom.googleapis.com/v1/userProfiles/me",
                    headers={"Authorization": f"Bearer {plain_at}"},
                )
                if me_resp.status_code == 200:
                    me_data = me_resp.json()
                    target_user_id = str(me_data.get("id") or me_data.get("emailAddress") or "").strip() or None
        except Exception as exc:
            logger.warning(f"Disconnect profile lookup failed: {_sanitize_error_msg(str(exc))}")

    query = select(ClassroomCredential)
    if payload.group_id:
        query = query.where(ClassroomCredential.group_id == payload.group_id)
    candidates = (await db.scalars(query)).all()

    to_delete: list[ClassroomCredential] = []
    tokens_to_revoke: set[str] = set()
    if plain_rt:
        tokens_to_revoke.add(plain_rt)
    if plain_at:
        tokens_to_revoke.add(plain_at)

    for cred in candidates:
        cred_rt = decrypt_token(cred.refresh_token)
        if target_user_id and cred.google_user_id == target_user_id:
            to_delete.append(cred)
            if cred_rt:
                tokens_to_revoke.add(cred_rt)
        elif plain_rt and cred_rt and cred_rt == plain_rt:
            to_delete.append(cred)
            tokens_to_revoke.add(cred_rt)

    deleted_count = 0
    for cred in to_delete:
        await db.delete(cred)
        deleted_count += 1

    await db.commit()

    revoked = False
    if tokens_to_revoke:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for tok in tokens_to_revoke:
                try:
                    rev_resp = await client.post(
                        "https://oauth2.googleapis.com/revoke",
                        params={"token": tok},
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                    )
                    if rev_resp.status_code == 200:
                        revoked = True
                except Exception as exc:
                    logger.warning(f"Google token revoke warning: {_sanitize_error_msg(str(exc))}")

    return {
        "status": "disconnected",
        "deleted_credentials": deleted_count,
        "revoked": revoked,
    }


async def _fetch_user_submissions(
    db: AsyncSession,
    group_id: Optional[int] = None,
    google_user_id: Optional[str] = None,
    email: Optional[str] = None,
    access_token: Optional[str] = None,
    refresh_token: Optional[str] = None,
) -> dict[str, Any]:
    eff_user_id = (google_user_id or "").strip() or None
    if eff_user_id and eff_user_id.startswith("legacy_group_"):
        eff_user_id = None

    eff_email = (email or "").strip() or None
    if eff_email in ("підключено", "connected", ""):
        eff_email = None

    token = (access_token or "").strip() or None
    plain_rt = decrypt_token(refresh_token) if refresh_token else ""
    cred: Optional[ClassroomCredential] = None
    refreshed_access_token: Optional[str] = None

    if token and not token.startswith("ya29."):
        token = None

    # БЕЗПЕКА: Шукаємо ClassroomCredential ВИКЛЮЧНО за особистим google_user_id або email користувача!
    # Жодних фолбеків за самим лише group_id, щоб ніколи не підтягнути чужий акаунт одногрупника.
    if eff_user_id or eff_email:
        if eff_user_id and eff_email:
            # Якщо є обидва — пріоритет точному збігу ID або пошти цього студента
            cred = await db.scalar(
                select(ClassroomCredential)
                .where(
                    ClassroomCredential.is_active.is_(True),
                    (ClassroomCredential.google_user_id == eff_user_id)
                    | (func.lower(ClassroomCredential.email) == eff_email.lower()),
                )
                .order_by(ClassroomCredential.last_synced_at.desc().nullslast())
            )
        elif eff_user_id:
            cred = await db.scalar(
                select(ClassroomCredential)
                .where(
                    ClassroomCredential.is_active.is_(True),
                    ClassroomCredential.google_user_id == eff_user_id,
                )
                .order_by(ClassroomCredential.last_synced_at.desc().nullslast())
            )
        elif eff_email:
            cred = await db.scalar(
                select(ClassroomCredential)
                .where(
                    ClassroomCredential.is_active.is_(True),
                    func.lower(ClassroomCredential.email) == eff_email.lower(),
                )
                .order_by(ClassroomCredential.last_synced_at.desc().nullslast())
            )

    if not token and cred and cred.refresh_token:
        fresh_tok, _, _ = await classroom_tokens._refresh_google_token_detailed(cred.refresh_token)
        if fresh_tok:
            token = fresh_tok
            refreshed_access_token = fresh_tok

    if not token and plain_rt:
        fresh_tok, _, _ = await classroom_tokens._refresh_google_token_detailed(plain_rt)
        if fresh_tok:
            token = fresh_tok
            refreshed_access_token = fresh_tok

    if not token:
        return {
            "connected": False,
            "submissions": {},
            "tasks": [],
            "reason": "unauthenticated",
        }

    try:
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            courses_resp = await client.get(
                "https://classroom.googleapis.com/v1/courses",
                params={"courseStates": "ACTIVE", "pageSize": 50},
                headers=headers,
            )
            if courses_resp.status_code == 401:
                rt_to_try = cred.refresh_token if cred else plain_rt
                if rt_to_try:
                    fresh_tok, _, _ = await classroom_tokens._refresh_google_token_detailed(rt_to_try)
                    if fresh_tok:
                        token = fresh_tok
                        refreshed_access_token = fresh_tok
                        headers = {"Authorization": f"Bearer {token}"}
                        courses_resp = await client.get(
                            "https://classroom.googleapis.com/v1/courses",
                            params={"courseStates": "ACTIVE", "pageSize": 50},
                            headers=headers,
                        )

            if courses_resp.status_code != 200:
                is_perm = _is_permanent_courses_error(courses_resp.status_code, courses_resp.text)
                if cred:
                    if is_perm:
                        cred.needs_relink = True
                        cred.is_active = False
                        cred.last_error = f"needs_relink: courses_error_{courses_resp.status_code}"
                    else:
                        _apply_credential_backoff(
                            cred,
                            f"courses_error_{courses_resp.status_code}",
                            datetime.now(timezone.utc),
                        )
                    await db.commit()
                return {
                    "connected": False,
                    "submissions": {},
                    "tasks": [],
                    "reason": f"courses_error_{courses_resp.status_code}",
                    "needs_relink": is_perm,
                    "reason_code": (
                        ("revoked" if courses_resp.status_code == 401 else "api_error")
                        if is_perm
                        else "temporary_error"
                    ),
                }

            all_courses = courses_resp.json().get("courses", [])
            if not all_courses:
                return {
                    "connected": True,
                    "user_email": cred.email if cred else eff_email,
                    "submissions": {},
                    "tasks": [],
                    "access_token": refreshed_access_token or token,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }

            all_active_groups = (await db.scalars(select(Group).where(Group.is_active.is_(True)))).all()
            target_group = await db.get(Group, group_id) if group_id else None

            detected_group_id: Optional[int] = cred.group_id if cred else None
            relevant_courses = []
            for c in all_courses:
                full_title = f"{c.get('name', '')} {c.get('section', '')} {c.get('descriptionHeading', '')}".strip()
                matched_g = _extract_group_from_course_name(full_title, all_active_groups)
                if matched_g:
                    if not detected_group_id:
                        detected_group_id = matched_g.id
                    if target_group and matched_g.id == target_group.id:
                        relevant_courses.append(c)
                else:
                    relevant_courses.append(c)

            if not relevant_courses:
                relevant_courses = all_courses[:25]
            else:
                relevant_courses = relevant_courses[:25]

            sem = asyncio.Semaphore(5)

            async def fetch_bundle(course: dict):
                c_id = course["id"]
                async with sem:
                    cw_task = client.get(
                        f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWork",
                        params={"courseWorkStates": "PUBLISHED", "pageSize": 100},
                        headers=headers,
                    )
                    sub_task = client.get(
                        f"https://classroom.googleapis.com/v1/courses/{c_id}/courseWork/-/studentSubmissions",
                        params={"userId": "me", "pageSize": 100},
                        headers=headers,
                    )
                    return course, await asyncio.gather(cw_task, sub_task, return_exceptions=True)

            results = await asyncio.gather(*(fetch_bundle(c) for c in relevant_courses))

            submissions_map: dict[str, dict] = {}
            tasks_list: list[dict] = []
            eff_gid = detected_group_id or group_id
            mapped_by_url: dict[str, dict] = {
                str(gt.get("url") or gt.get("alternate_link")): gt
                for gt in (_latest_group_tasks.get(eff_gid) or [])
                if eff_gid and (gt.get("url") or gt.get("alternate_link"))
            }
            if eff_gid:
                db_notes = (
                    await db.scalars(
                        select(LessonOccurrenceNote).where(
                            LessonOccurrenceNote.group_id == eff_gid,
                            LessonOccurrenceNote.archived.is_(False),
                            LessonOccurrenceNote.note.like("%[TASK%"),
                        )
                    )
                ).all()
                for n_row in db_notes:
                    if not n_row.subject_name:
                        continue
                    for l_line in (n_row.note or "").split("\n"):
                        l_line = l_line.strip()
                        if not l_line.startswith("[TASK"):
                            continue
                        u_match = URL_RE.search(l_line)
                        if u_match and u_match.group(0) not in mapped_by_url:
                            mapped_by_url[u_match.group(0)] = {
                                "subject": n_row.subject_name,
                                "course_name": n_row.subject_name,
                            }

            for course, bundle_items in results:
                if not isinstance(bundle_items, (list, tuple)) or len(bundle_items) < 2:
                    continue
                cw_resp, sub_resp = bundle_items[:2]
                c_id = course["id"]
                c_title = f"{course.get('name', '')} {course.get('section', '')}".strip()
                c_clean = re.sub(
                    r"\s*[\(\[]\s*(?:гр(?:упа|\.)?\s*)?\d{1,3}[\s\-_–—]?(?:[А-Яа-яA-Za-z]+)?\s*[\)\]]",
                    "",
                    c_title,
                    flags=re.IGNORECASE,
                ).strip() or c_title

                subs_by_cw: dict[str, dict] = {}
                if not isinstance(sub_resp, Exception) and getattr(sub_resp, "status_code", 0) == 200:
                    for sub in sub_resp.json().get("studentSubmissions", []):
                        cw_id = sub.get("courseWorkId")
                        if cw_id:
                            st = sub.get("state") or "NEW"
                            assigned_g = sub.get("assignedGrade")
                            draft_g = sub.get("draftGrade")
                            grade_val = assigned_g if assigned_g is not None else draft_g
                            subs_by_cw[cw_id] = {
                                "state": st,
                                "grade": grade_val,
                            }

                if not isinstance(cw_resp, Exception) and getattr(cw_resp, "status_code", 0) == 200:
                    for cw in cw_resp.json().get("courseWork", []):
                        cw_id = cw.get("id")
                        alt_link = cw.get("alternateLink")
                        if not cw_id or not alt_link:
                            continue
                        sub_info = subs_by_cw.get(cw_id)
                        state = sub_info["state"] if sub_info else "NEW"
                        grade = sub_info["grade"] if sub_info else None
                        max_pts = cw.get("maxPoints")

                        due = cw.get("dueDate")
                        due_iso = None
                        if due and due.get("year") and due.get("month") and due.get("day"):
                            try:
                                due_iso = f"{int(due['year']):04d}-{int(due['month']):02d}-{int(due['day']):02d}"
                            except Exception:
                                due_iso = None

                        title = re.sub(r"\s+", " ", (cw.get("title") or "").replace("|", "/")).strip() or "Без назви"

                        mapped_gt = mapped_by_url.get(alt_link) or {}
                        resolved_subj = mapped_gt.get("subject") or mapped_gt.get("course_name") or c_clean
                        resolved_teacher = mapped_gt.get("teacher")

                        task_obj = {
                            "id": cw_id,
                            "course_id": c_id,
                            "course_name": resolved_subj,
                            "title": title,
                            "subject": resolved_subj,
                            "teacher": resolved_teacher,
                            "url": alt_link,
                            "alternate_link": alt_link,
                            "state": state,
                            "grade": grade,
                            "assigned_grade": grade,
                            "max_points": max_pts,
                            "due_date": due_iso,
                            "creation_time": cw.get("creationTime") or cw.get("updateTime"),
                            "created_at": cw.get("creationTime") or cw.get("updateTime"),
                        }
                        tasks_list.append(task_obj)

                        sub_obj = {
                            "state": state,
                            "grade": grade,
                            "maxPoints": max_pts,
                        }
                        submissions_map[alt_link] = sub_obj
                        key = f"{c_id}_{cw_id}"
                        submissions_map[key] = sub_obj

            return {
                "connected": True,
                "group_id": detected_group_id,
                "user_email": cred.email if cred else eff_email,
                "google_user_id": cred.google_user_id if cred else eff_user_id,
                "submissions": submissions_map,
                "tasks": tasks_list,
                "access_token": refreshed_access_token or token,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "needs_relink": bool(cred and getattr(cred, "needs_relink", False)),
            }
    except Exception as exc:
        logger.error(f"User submissions fetch error: {_sanitize_error_msg(str(exc))}")
        return {
            "connected": False,
            "submissions": {},
            "tasks": [],
            "reason": "network_error",
        }


async def _build_group_accounts_summary(db: AsyncSession, group_id: int) -> dict:
    """25.7: Точна статистика підключених Classroom-акаунтів групи для адмінки та статусу."""
    raw_creds = (
        await db.scalars(
            select(ClassroomCredential)
            .where(ClassroomCredential.group_id == group_id)
            .order_by(ClassroomCredential.last_synced_at.desc().nullslast(), ClassroomCredential.id.desc())
        )
    ).all()

    # Автоматично прибираємо застарілі фейкові записи міграції (legacy_group_*), якщо є реальні акаунти
    has_real_creds = any(
        c.google_user_id and not c.google_user_id.startswith("legacy_group_")
        for c in raw_creds
    )
    creds: list[ClassroomCredential] = []
    seen_identities: set[str] = set()

    for c in raw_creds:
        if has_real_creds and c.google_user_id and c.google_user_id.startswith("legacy_group_"):
            continue
        identity_key = (c.email or c.google_user_id or str(c.id)).strip().lower()
        if identity_key in seen_identities:
            continue
        seen_identities.add(identity_key)
        creds.append(c)

    now_utc = datetime.now(timezone.utc)

    def _is_cred_healthy(c: ClassroomCredential) -> bool:
        if getattr(c, "needs_relink", False):
            return False
        if _is_permanent_token_error(c.last_error):
            return False

        # 1. Якщо є валідний refresh_token (1//...) і немає фатальної помилки відкликання
        plain_rt = decrypt_token(c.refresh_token) if c.refresh_token else ""
        if plain_rt and plain_rt.startswith("1//"):
            return True

        # 2. Якщо студент синхронізувався нещодавно (< 55 хвилин тому), його сесія ще активна
        if c.last_synced_at:
            ts = c.last_synced_at if c.last_synced_at.tzinfo else c.last_synced_at.replace(tzinfo=timezone.utc)
            if (now_utc - ts).total_seconds() < 55 * 60:
                return True

        return False

    effective_active_creds = [c for c in creds if _is_cred_healthy(c)]
    active_count = len(effective_active_creds)
    needs_reconnect = bool(creds) and active_count == 0

    subgroup_lessons_count = await db.scalar(
        select(func.count(Schedule.id)).where(
            Schedule.group_id == group_id,
            Schedule.second_teacher_id.is_not(None),
            Schedule.is_active.is_(True),
        )
    ) or 0
    has_subgroups = subgroup_lessons_count > 0

    covered_subgroups = {c.subgroup for c in effective_active_creds if c.subgroup in (1, 2)}

    subgroup_warning: Optional[str] = None
    if active_count == 0:
        subgroup_warning = "Для цієї групи немає жодного активного Classroom-акаунта з дійсним токеном."
    elif has_subgroups:
        if 1 in covered_subgroups and 2 not in covered_subgroups:
            subgroup_warning = "Підключено лише 1-шу підгрупу. Для повного розкладу додайте 1 студента з 2-ї підгрупи."
        elif 2 in covered_subgroups and 1 not in covered_subgroups:
            subgroup_warning = "Підключено лише 2-гу підгрупу. Для повного розкладу додайте 1 студента з 1-ї підгрупи."
        elif active_count < 2 and len(covered_subgroups) < 2:
            subgroup_warning = (
                "Група має поділ на підгрупи, але підключено лише 1 акаунт. "
                "Бажано підключити по одному студенту з кожної підгрупи."
            )

    latest_sync_dt: Optional[datetime] = None
    for c in creds:
        if c.last_synced_at:
            ts = c.last_synced_at if c.last_synced_at.tzinfo else c.last_synced_at.replace(tzinfo=timezone.utc)
            if latest_sync_dt is None or ts > latest_sync_dt:
                latest_sync_dt = ts

    students = (
        await db.scalars(
            select(GroupStudent).where(GroupStudent.group_id == group_id)
        )
    ).all()
    student_by_uid: dict[str, GroupStudent] = {s.classroom_user_id: s for s in students if s.classroom_user_id}
    student_by_email: dict[str, GroupStudent] = {s.email.lower(): s for s in students if s.email}

    account_items = []
    for c in creds:
        matched: Optional[GroupStudent] = student_by_uid.get(c.google_user_id)
        if not matched and c.email:
            matched = student_by_email.get(c.email.lower())
        if not matched and c.google_user_id and "@" in c.google_user_id:
            matched = student_by_email.get(c.google_user_id.lower())

        student_name = c.student_name or (matched.full_name if matched else None)
        email = c.email or (matched.email if matched else None)
        photo_url = c.photo_url or (matched.photo_url if matched else None)
        healthy = _is_cred_healthy(c)

        account_items.append({
            "id": c.id,
            "google_user_id": c.google_user_id,
            "email": email,
            "student_name": student_name or email or "Студент групи",
            "photo_url": photo_url,
            "subgroup": c.subgroup,
            "last_synced_at": _iso_utc(c.last_synced_at),
            "last_error": c.last_error,
            "fail_count": c.fail_count or 0,
            "next_attempt_at": _iso_utc(c.next_attempt_at),
            "needs_relink": bool(getattr(c, "needs_relink", False)),
            "is_active": healthy,
        })

    group_backoff_until: Optional[str] = None
    backoff_entry = _sync_backoff_state.get(group_id)
    if backoff_entry:
        remaining = backoff_entry[1] - _time.monotonic()
        if remaining > 0:
            group_backoff_until = _iso_utc(now_utc + timedelta(seconds=remaining))

    worker_heartbeat = await _read_classroom_heartbeat(db)

    return {
        "connected_accounts_count": active_count,
        "total_accounts_count": len(creds),
        "has_subgroups": has_subgroups,
        "subgroup_warning": subgroup_warning,
        "latest_cred_synced_at": _iso_utc(latest_sync_dt),
        "needs_reconnect": needs_reconnect,
        "sync_in_progress": group_id in _SYNC_LOCK_GROUPS,
        "group_backoff_until": group_backoff_until,
        "worker_heartbeat": worker_heartbeat,
        "accounts": account_items,
    }


async def reconstruct_tasks_from_notes(
    db: AsyncSession,
    group_id: int,
    binding: Optional[ClassroomGroupBinding],
) -> list[dict]:
    notes = (
        await db.scalars(
            select(LessonOccurrenceNote).where(
                LessonOccurrenceNote.group_id == group_id,
                LessonOccurrenceNote.archived.is_(False),
                LessonOccurrenceNote.note.like("%[TASK]%"),
            )
        )
    ).all()
    reconstructed: list[dict] = []
    seen_urls: set[str] = set()
    for n in notes:
        subj = n.subject_name or (binding.course_name if binding else "Дисципліна")
        for line in n.note.split("\n"):
            line = line.strip()
            if not line.startswith("[TASK"):
                continue
            raw = line.replace("[TASK]", "").strip()
            parts = [p.strip() for p in raw.split("|")]
            if len(parts) < 2:
                continue
            left_part = parts[0]
            url_part = parts[1]
            if not url_part.startswith("http") or url_part in seen_urls:
                continue
            seen_urls.add(url_part)

            max_points_val = None
            for extra in parts[2:]:
                if extra.lower().startswith("max_points="):
                    try:
                        f_val = float(extra.split("=", 1)[1].strip())
                        max_points_val = int(f_val) if f_val.is_integer() else f_val
                    except ValueError:
                        max_points_val = None

            teacher = None
            rest = left_part
            badge_m = re.match(r"^\[([^\]]+)\]\s*(.*)$", left_part)
            if badge_m:
                teacher = badge_m.group(1).strip()
                rest = badge_m.group(2).strip()

            due_match = re.search(r"\(до\s+(\d{1,2})\.(\d{1,2})\)", rest, re.IGNORECASE)
            due_date_iso = None
            if due_match:
                d_day = int(due_match.group(1))
                d_month = int(due_match.group(2))
                cur_year = n.note_date.year if n.note_date else datetime.now(timezone.utc).year
                due_date_iso = f"{cur_year}-{d_month:02d}-{d_day:02d}"
                title_clean = re.sub(r"\(до\s+\d{1,2}\.\d{1,2}\)", "", rest, flags=re.IGNORECASE).strip()
            else:
                title_clean = rest

            reconstructed.append({
                "id": url_part,
                "course_id": binding.course_id if binding else "",
                "course_name": subj or (binding.course_name if binding else "Дисципліна"),
                "title": title_clean or "Завдання",
                "subject": subj,
                "teacher": teacher,
                "due_date": due_date_iso,
                "creation_time": due_date_iso,
                "created_at": due_date_iso,
                "url": url_part,
                "alternate_link": url_part,
                "state": "NEW",
                "grade": None,
                "max_points": max_points_val,
            })
    classroom_state._latest_group_tasks[group_id] = reconstructed
    return reconstructed
