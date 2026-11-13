import asyncio
import logging
import time as _time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.time import KYIV_TZ
from app.database import async_session_factory
from app.models import (
    ClassroomCredential,
    ClassroomGroupBinding,
    Group,
    Schedule,
)
from app.services.classroom import sync as classroom_sync
from app.services.classroom import tokens as classroom_tokens
from app.services.classroom.state import (
    MAX_ACCOUNTS_PER_CYCLE,
    _SYNC_LOCK_GROUPS,
    _iso_utc,
    _last_request_trigger,
    _read_classroom_heartbeat,
    _sync_backoff_state,
    _write_classroom_heartbeat,
)
from app.services.classroom.tokens import (
    _apply_credential_backoff,
    _is_permanent_token_error,
    _is_transient_recoverable_error,
    _sanitize_error_msg,
    decrypt_token,
    decrypt_token_detailed,
    encrypt_token,
    rotate_token,
)

logger = logging.getLogger(__name__)


async def run_background_sync_task(group_id: int, force: bool = False) -> None:
    """Неблокуюча фонова задача синхронізації у власній сесії БД."""
    async with async_session_factory() as db:
        await trigger_background_sync_if_needed(db, group_id, force=force)


# Classroom background synchronization timings:
# Adaptive scheduling aligns with college classes (09:00 - 15:30):
# - Peak classes & prep (Mon-Fri 08:30 - 16:00): 10 min
# - Post-class homework (Mon-Fri 16:00 - 21:30): 35 min
# - Late evening (Mon-Fri 21:30 - 23:30): 60 min
# - Night sleep (daily 23:30 - 08:30): sleep until 08:30 morning
# - Weekend day (Sat-Sun 10:00 - 20:00): 90 min
# - Weekend night (Sat-Sun 20:00 - 10:00): sleep mode
def get_adaptive_classroom_sync_interval_seconds(now_kyiv: Optional[datetime] = None) -> int:
    """
    Розраховує адаптивний інтервал фонової автосинхронізації Classroom на основі реального графіку пар:
    - Будні (Пн-Пт) 08:30–16:00 (підготовка та розпал пар 09:00–15:30): 10 хвилин (600 с або settings.classroom_sync_interval_minutes)
    - Будні (Пн-Пт) 16:00–21:30 (після пар / виконання ДЗ): 35 хвилин (2100 с)
    - Будні (Пн-Пт) 21:30–23:30 (пізній вечір): 60 хвилин (3600 с)
    - Щодня 23:30–08:30 (нічний сон коледжу): сон до 08:30 ранку (до 4 годин за цикл)
    - Вихідні (Сб-Нд) 10:00–20:00 (денний економ-режим): 90 хвилин (5400 с)
    - Вихідні (Сб-Нд) 20:00–10:00 (ніч на вихідних): сон до ранку (до 4 годин за цикл)
    """
    if now_kyiv is None:
        now_kyiv = datetime.now(KYIV_TZ)

    weekday = now_kyiv.weekday()  # 0=Monday .. 4=Friday, 5=Saturday, 6=Sunday
    is_weekend = weekday in (5, 6)
    total_minutes = now_kyiv.hour * 60 + now_kyiv.minute

    if is_weekend:
        # Вихідні дні (Сб-Нд)
        if 10 * 60 <= total_minutes < 20 * 60:
            return 90 * 60  # 1.5 години

        # Ніч на вихідних: до 10:00 (у суботу/неділю) або до 08:30 понеділка
        target_hour = 8 if (weekday == 6 and total_minutes >= 20 * 60) else 10
        target_minute = 30 if target_hour == 8 else 0
        target = now_kyiv.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
        if total_minutes >= 20 * 60:
            target += timedelta(days=1)
        secs = int((target - now_kyiv).total_seconds())
        return max(600, min(secs, 4 * 3600))

    # Будні дні (Пн-Пт)
    # 1. Підготовка та розпал занять (пари йдуть 09:00–15:30): 08:30 - 16:00
    if 8 * 60 + 30 <= total_minutes < 16 * 60:
        base_mins = getattr(settings, "classroom_sync_interval_minutes", 10) or 10
        return max(300, base_mins * 60)

    # 2. Після занять (виконання ДЗ студентами): 16:00 - 21:30
    if 16 * 60 <= total_minutes < 21 * 60 + 30:
        return 35 * 60

    # 3. Пізній вечір: 21:30 - 23:30
    if 21 * 60 + 30 <= total_minutes < 23 * 60 + 30:
        return 60 * 60

    # 4. Нічний час: 23:30 - 08:30 (коледж спить)
    target_morning = now_kyiv.replace(hour=8, minute=30, second=0, microsecond=0)
    if total_minutes >= 23 * 60 + 30:
        target_morning += timedelta(days=1)
    secs = int((target_morning - now_kyiv).total_seconds())
    return max(600, min(secs, 4 * 3600))


def _get_classroom_sync_interval_seconds(now_kyiv: Optional[datetime] = None) -> int:
    """Повертає адаптивний інтервал синхронізації Classroom.
    Якщо now_kyiv не передано, повертає базовий налаштований інтервал (для сумісності з тестами)."""
    if now_kyiv is not None:
        return get_adaptive_classroom_sync_interval_seconds(now_kyiv)
    return getattr(settings, "classroom_sync_interval_minutes", 10) * 60


def _get_classroom_min_sync_gap_seconds(now_kyiv: Optional[datetime] = None) -> float:
    interval = _get_classroom_sync_interval_seconds(now_kyiv)
    return max(120.0, float(interval) - 90.0)


def should_trigger_background_sync(group_id: Optional[int]) -> bool:
    """Cheap, DB-free check whether a public request may schedule a Classroom sync."""
    if not group_id or group_id in _SYNC_LOCK_GROUPS:
        return False
    now_mono = _time.monotonic()
    if now_mono < _sync_backoff_state.get(group_id, (0, 0.0))[1]:
        return False
    now_kyiv = datetime.now(KYIV_TZ)
    min_gap = _get_classroom_min_sync_gap_seconds(now_kyiv)
    if now_mono - _last_request_trigger.get(group_id, -min_gap) < min_gap:
        return False
    _last_request_trigger[group_id] = now_mono
    return True


async def trigger_background_sync_if_needed(
    db: AsyncSession,
    group_id: Optional[int],
    max_accounts: int = MAX_ACCOUNTS_PER_CYCLE,
    force: bool = False,
) -> None:
    if not group_id or group_id in _SYNC_LOCK_GROUPS:
        return

    now_mono = _time.monotonic()
    failures, _ = _sync_backoff_state.get(group_id, (0, 0.0))
    if not force and now_mono < _sync_backoff_state.get(group_id, (0, 0.0))[1]:
        return

    _SYNC_LOCK_GROUPS.add(group_id)
    try:
        group = await db.get(Group, group_id)
        if not group:
            return

        now = datetime.now(timezone.utc)

        # Перевіряємо наявність записів у новій таблиці classroom_credentials
        all_creds = (
            await db.scalars(
                select(ClassroomCredential).where(ClassroomCredential.group_id == group_id)
            )
        ).all()

        binding = await db.scalar(
            select(ClassroomGroupBinding).where(
                ClassroomGroupBinding.group_id == group_id,
                ClassroomGroupBinding.is_active.is_(True),
            )
        )
        logger.info(
            "Classroom sync group_id=%s: credentials=%d active=%d binding=%s refresh_tokens=%d",
            group_id,
            len(all_creds),
            sum(1 for c in all_creds if c.is_active),
            bool(binding),
            sum(1 for c in all_creds if c.is_active and c.refresh_token),
        )

        if all_creds:
            # Відновлюємо записи, що застрягли через відсутній секрет або тимчасові збої (429/5xx/timeout)
            has_secret = bool(classroom_tokens.get_google_client_secret())
            recovered_any = False
            for c in all_creds:
                if c.is_active and c.last_error and "missing_client_secret" in c.last_error and has_secret:
                    c.last_error = None
                    c.fail_count = 0
                    c.next_attempt_at = None
                    recovered_any = True
                elif (not c.is_active or getattr(c, "needs_relink", False)) and _is_transient_recoverable_error(c.last_error):
                    if "missing_client_secret" in (c.last_error or "").lower() and not has_secret:
                        continue
                    plain_rt, _ = decrypt_token_detailed(c.refresh_token) if c.refresh_token else (None, "empty")
                    if plain_rt and plain_rt.startswith("1//"):
                        c.is_active = True
                        c.needs_relink = False
                        c.last_error = None
                        c.fail_count = 0
                        c.next_attempt_at = None
                        recovered_any = True

            # 25.5: Беремо активні записи групи, для яких настав час спроби,
            # відсортовані за last_synced_at (найстаріший першим, NULLS FIRST).
            def _is_ready(c: ClassroomCredential) -> bool:
                if not c.is_active or getattr(c, "needs_relink", False):
                    return False
                if force or c.next_attempt_at is None:
                    return True
                na = c.next_attempt_at if c.next_attempt_at.tzinfo else c.next_attempt_at.replace(tzinfo=timezone.utc)
                return na <= now

            active_creds = [c for c in all_creds if _is_ready(c)]
            if not active_creds:
                if recovered_any:
                    await db.commit()
                logger.warning("Classroom sync group_id=%s: no ready active credentials", group_id)
                return

            def _cred_sort_key(c: ClassroomCredential):
                if c.last_synced_at is None:
                    return (0, datetime.min.replace(tzinfo=timezone.utc), c.id or 0)
                ts = c.last_synced_at if c.last_synced_at.tzinfo else c.last_synced_at.replace(tzinfo=timezone.utc)
                return (1, ts, c.id or 0)

            active_creds.sort(key=_cred_sort_key)

            # Перевіряємо min_gap за справді найстарішим (або ще несинхронізованим) акаунтом ДО перестановки за підгрупами
            oldest = active_creds[0]
            if not force and oldest.last_synced_at is not None:
                oldest_ts = oldest.last_synced_at if oldest.last_synced_at.tzinfo else oldest.last_synced_at.replace(tzinfo=timezone.utc)
                now_kyiv = now.astimezone(KYIV_TZ)
                min_gap = _get_classroom_min_sync_gap_seconds(now_kyiv)
                if (now - oldest_ts).total_seconds() < min_gap:
                    if recovered_any:
                        await db.commit()
                    logger.debug(
                        "Classroom sync group_id=%s skipped: last synced %.0fs ago (min gap %.0fs)",
                        group_id,
                        (now - oldest_ts).total_seconds(),
                        min_gap,
                    )
                    return

            # Якщо у групи є поділ на підгрупи — пріоритезуємо по 1 найстарішому з кожної підгрупи,
            # але не обрізаємо решту акаунтів, щоб усі проходили чесну ротацію.
            has_split = await db.scalar(
                select(func.count(Schedule.id)).where(
                    Schedule.group_id == group_id,
                    Schedule.second_teacher_id.is_not(None),
                    Schedule.is_active.is_(True),
                )
            ) or 0
            if has_split > 0 and len(active_creds) > 1:
                sub1 = [c for c in active_creds if c.subgroup == 1]
                sub2 = [c for c in active_creds if c.subgroup == 2]
                chosen = []
                if sub1:
                    chosen.append(sub1[0])
                if sub2:
                    chosen.append(sub2[0])
                for c in active_creds:
                    if c not in chosen:
                        chosen.append(c)
                active_creds = chosen

            synced_count = 0
            seen_course_ids: set[str] = set()
            any_synced = False
            effective_max = len(active_creds) if force else max(1, max_accounts)

            for cred in active_creds:
                if synced_count >= effective_max:
                    break

                fresh_token, err_msg, status_code = await classroom_tokens._refresh_google_token_detailed(cred.refresh_token)
                if not fresh_token:
                    logger.warning(
                        "Classroom sync group_id=%s credential_id=%s token refresh failed: %s",
                        group_id,
                        cred.id,
                        _sanitize_error_msg(err_msg or f"status_{status_code}"),
                    )
                    if _is_permanent_token_error(err_msg):
                        # Непоправна помилка токена деактивує запис і вимагає перепідключення
                        cred.is_active = False
                        cred.needs_relink = True
                        cred.fail_count = (cred.fail_count or 0) + 1
                        cred.last_error = _sanitize_error_msg(err_msg)
                        cred.next_attempt_at = None
                    else:
                        _apply_credential_backoff(cred, err_msg or f"refresh_failed_{status_code}", now)
                    await db.flush()
                    continue

                # Auto-upgrade token in DB if it was decrypted via an older or legacy key
                cred.last_refresh_ok_at = now
                rotated = rotate_token(cred.refresh_token)
                if rotated:
                    cred.refresh_token = rotated

                headers = {"Authorization": f"Bearer {fresh_token}"}

                # 25.4.3: Автоматично збагачуємо або відновлюємо профіль користувача (ім'я, пошта, аватарка), якщо вони відсутні або були обрізані
                if (
                    not cred.student_name
                    or not cred.email
                    or not cred.photo_url
                    or (cred.photo_url and len(cred.photo_url) == 500 and "googleusercontent.com" in cred.photo_url)
                ):
                    try:
                        async with httpx.AsyncClient(timeout=8.0) as prof_client:
                            # 1. Спершу стандартний Google OAuth2 userinfo (найнадійніший для повнорозмірних аватарок picture)
                            ui_r = await prof_client.get(
                                "https://www.googleapis.com/oauth2/v3/userinfo",
                                headers=headers,
                            )
                            if ui_r.status_code == 200:
                                ui_j = ui_r.json()
                                fn = (ui_j.get("name") or "").strip() or None
                                em = (ui_j.get("email") or "").strip() or None
                                p_url = (ui_j.get("picture") or "").strip() or None
                                if fn and not cred.student_name:
                                    cred.student_name = fn[:150]
                                if em and not cred.email:
                                    cred.email = em[:150]
                                if p_url:
                                    cred.photo_url = p_url[:2048]

                            # 2. Якщо щось досі відсутнє — доповнюємо з Classroom userProfiles/me
                            if not cred.student_name or not cred.email or not cred.photo_url:
                                me_r = await prof_client.get(
                                    "https://classroom.googleapis.com/v1/userProfiles/me",
                                    headers=headers,
                                )
                                if me_r.status_code == 200:
                                    me_j = me_r.json()
                                    n_obj = me_j.get("name") or {}
                                    fn = (n_obj.get("fullName") or "").strip() or None
                                    em = (me_j.get("emailAddress") or "").strip() or None
                                    p_url = (me_j.get("photoUrl") or "").strip() or None
                                    if p_url and p_url.startswith("//"):
                                        p_url = f"https:{p_url}"
                                    if fn and not cred.student_name:
                                        cred.student_name = fn[:150]
                                    if em and not cred.email:
                                        cred.email = em[:150]
                                    if p_url and not cred.photo_url:
                                        cred.photo_url = p_url[:2048]
                    except Exception:
                        pass

                try:
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        courses_resp = await client.get(
                            "https://classroom.googleapis.com/v1/courses",
                            params={"courseStates": "ACTIVE", "pageSize": 100},
                            headers=headers,
                        )
                except Exception as req_exc:
                    _apply_credential_backoff(cred, f"network_error: {req_exc}", now)
                    await db.flush()
                    continue

                if courses_resp.status_code in (401, 403, 429):
                    _apply_credential_backoff(
                        cred,
                        f"courses_http_{courses_resp.status_code}",
                        now,
                    )
                    await db.flush()
                    continue
                if courses_resp.status_code != 200:
                    _apply_credential_backoff(
                        cred,
                        f"courses_http_{courses_resp.status_code}",
                        now,
                    )
                    await db.flush()
                    continue

                courses = courses_resp.json().get("courses", [])
                sync_res = await classroom_sync.perform_course_sync(
                    db,
                    group,
                    courses,
                    fresh_token,
                    group_course_id=binding.course_id if binding else None,
                    skip_course_ids=seen_course_ids,
                    force=force,
                )
                for cid in sync_res.get("deduplicable_course_ids", sync_res.get("synced_course_ids", [])):
                    seen_course_ids.add(str(cid))

                cred.last_synced_at = now
                cred.fail_count = 0
                cred.last_error = None
                cred.next_attempt_at = None
                cred.needs_relink = False
                cred.is_active = True
                any_synced = True
                synced_count += 1
                logger.info(
                    "Classroom sync group_id=%s credential_id=%s synced courses=%d",
                    group_id,
                    cred.id,
                    len(courses),
                )
                await db.flush()

            if any_synced:
                if binding:
                    binding.last_synced_at = now
                group.updated_at = now
                await db.commit()
                from app.services import cache_rev
                cache_rev.bump([group_id])
                _sync_backoff_state.pop(group_id, None)
                return

            await db.commit()

        # 25.8.1: Фолбек на стару таблицю classroom_group_bindings, якщо у новій ще немає записів або всі акаунти зазнали помилки
        if not binding:
            logger.warning("Classroom sync group_id=%s: no active binding fallback", group_id)
            return

        if not force and binding.last_synced_at:
            b_ts = binding.last_synced_at if binding.last_synced_at.tzinfo else binding.last_synced_at.replace(tzinfo=timezone.utc)
            now_kyiv = now.astimezone(KYIV_TZ)
            min_gap = _get_classroom_min_sync_gap_seconds(now_kyiv)
            if (now - b_ts).total_seconds() < min_gap:
                logger.debug(
                    "Classroom sync group_id=%s legacy skipped: last synced %.0fs ago (min gap %.0fs)",
                    group_id,
                    (now - b_ts).total_seconds(),
                    min_gap,
                )
                return

        token = decrypt_token(binding.access_token) if binding.access_token else None
        if binding.refresh_token:
            fresh = await classroom_tokens._refresh_google_token(binding.refresh_token)
            if fresh:
                token = fresh
                binding.access_token = encrypt_token(fresh)
            elif not token:
                logger.warning(
                    "Classroom sync group_id=%s legacy binding refresh failed: no usable token",
                    group_id,
                )
                new_fails = failures + 1
                delay = min(14400.0, 900.0 * (2 ** min(new_fails, 4)))
                _sync_backoff_state[group_id] = (new_fails, _time.monotonic() + delay)
                return

        if not token:
            logger.warning("Classroom sync group_id=%s: no usable access token", group_id)
            return

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            courses_resp = await client.get(
                "https://classroom.googleapis.com/v1/courses",
                params={"courseStates": "ACTIVE", "pageSize": 100},
                headers=headers,
            )
            if courses_resp.status_code in (401, 403, 429):
                new_fails = failures + 1
                delay = min(14400.0, 900.0 * (2 ** min(new_fails, 4)))
                _sync_backoff_state[group_id] = (new_fails, _time.monotonic() + delay)
                if courses_resp.status_code in (401, 403) and not binding.refresh_token:
                    binding.access_token = None
                    await db.commit()
                return
            if courses_resp.status_code != 200:
                logger.warning(
                    "Classroom sync group_id=%s courses request failed: HTTP %s",
                    group_id,
                    courses_resp.status_code,
                )
                return
            courses = courses_resp.json().get("courses", [])

        binding.last_synced_at = now
        group.updated_at = now
        await classroom_sync.perform_course_sync(
            db,
            group,
            courses,
            token,
            group_course_id=binding.course_id,
            force=force,
        )
        await db.commit()
        from app.services import cache_rev
        cache_rev.bump([group_id])
        logger.info("Classroom sync group_id=%s legacy binding synced courses=%d", group_id, len(courses))
        _sync_backoff_state.pop(group_id, None)
    except Exception as e:
        new_fails = failures + 1
        delay = min(7200.0, 300.0 * (2 ** min(new_fails, 4)))
        _sync_backoff_state[group_id] = (new_fails, _time.monotonic() + delay)
        logger.warning(f"Background Classroom sync failed for group {group_id} (backoff {delay:.0f}s): {_sanitize_error_msg(str(e))}")
        await db.rollback()
    finally:
        _SYNC_LOCK_GROUPS.discard(group_id)


async def sync_all_connected_groups_once(force: bool = False) -> dict:
    """Проходить по всіх підключених групах у classroom_credentials та classroom_group_bindings і оновлює їх розклад."""
    started_at = datetime.now(timezone.utc)
    synced_groups: list[int] = []
    errors: list[dict[str, Any]] = []

    async with async_session_factory() as db:
        cred_group_ids = set(
            (
                await db.scalars(
                    select(ClassroomCredential.group_id).where(
                        or_(
                            ClassroomCredential.is_active.is_(True),
                            ClassroomCredential.last_error.ilike("%429%"),
                            ClassroomCredential.last_error.ilike("%courses_error_5%"),
                            ClassroomCredential.last_error.ilike("%courses_http_5%"),
                            ClassroomCredential.last_error.ilike("%missing_client_secret%"),
                        )
                    )
                )
            ).all()
        )
        binding_group_ids = set(
            (
                await db.scalars(
                    select(ClassroomGroupBinding.group_id).where(
                        ClassroomGroupBinding.is_active.is_(True)
                    )
                )
            ).all()
        )
        group_ids = sorted(cred_group_ids | binding_group_ids)
    logger.info(
        "Classroom auto-sync: found %d connected group(s), force=%s, groups=%s",
        len(group_ids),
        force,
        group_ids,
    )

    for gid in group_ids:
        try:
            logger.info("Classroom auto-sync: processing group_id=%s", gid)
            async with async_session_factory() as db:
                await asyncio.wait_for(
                    trigger_background_sync_if_needed(db, gid, force=force),
                    timeout=120.0,
                )
                synced_groups.append(gid)
            await asyncio.sleep(3)  # Пауза між групами для захисту від Google API Rate Limit
        except asyncio.TimeoutError:
            logger.warning("Auto-sync timed out after 120s for group %s", gid)
            errors.append({"group_id": gid, "error": "timeout_120s"})
        except Exception as e:
            err_text = _sanitize_error_msg(str(e))
            logger.warning(f"Auto-sync skipped for group {gid}: {err_text}")
            errors.append({"group_id": gid, "error": err_text})

    finished_at = datetime.now(timezone.utc)
    heartbeat_payload: dict[str, Any] = {
        "last_started_at": _iso_utc(started_at),
        "last_finished_at": _iso_utc(finished_at),
        "checked_groups": len(group_ids),
        "processed": synced_groups,
        "errors": errors,
        "force": force,
        "duration_ms": int((finished_at - started_at).total_seconds() * 1000),
    }
    try:
        async with async_session_factory() as hb_db:
            await _write_classroom_heartbeat(hb_db, heartbeat_payload)
    except Exception as hb_err:
        logger.debug("Could not persist classroom auto-sync heartbeat: %s", hb_err)

    logger.info("Classroom auto-sync: cycle complete, processed=%s, errors=%d", synced_groups, len(errors))
    return {"checked_groups": len(group_ids), "processed": synced_groups, "errors": errors}


async def perform_daily_credentials_health_check() -> dict:
    """О 06:00 за Києвом: швидка перевірка валідності refresh_token для всіх активних акаунтів."""
    logger.info("Classroom: starting daily credentials health check...")
    results = {"checked": 0, "ok": 0, "failed": 0}
    now = datetime.now(timezone.utc)
    async with async_session_factory() as db:
        creds = (
            await db.scalars(
                select(ClassroomCredential).where(
                    ClassroomCredential.is_active.is_(True),
                    ClassroomCredential.needs_relink.is_(False),
                )
            )
        ).all()
        for cred in creds:
            results["checked"] += 1
            fresh_tok, err_msg, status_code = await classroom_tokens._refresh_google_token_detailed(cred.refresh_token)
            if fresh_tok:
                cred.last_refresh_ok_at = now
                rotated = rotate_token(cred.refresh_token)
                if rotated:
                    cred.refresh_token = rotated
                cred.fail_count = 0
                cred.last_error = None
                cred.next_attempt_at = None
                results["ok"] += 1
            else:
                results["failed"] += 1
                if _is_permanent_token_error(err_msg):
                    cred.is_active = False
                    cred.needs_relink = True
                    cred.last_error = _sanitize_error_msg(err_msg)
                    cred.next_attempt_at = None
                else:
                    _apply_credential_backoff(cred, err_msg or f"status_{status_code}", now)
        await db.commit()
    logger.info("Classroom: daily credentials health check complete: %s", results)
    return results


async def classroom_auto_sync_loop() -> None:
    """Нескінченний фоновий цикл: розумно парсить Classroom за адаптивним інтервалом (під час пар 09:00–15:30 — кожні 10 хв, вечір — 35 хв, ніч — глибокий сон)."""
    now_k = datetime.now(KYIV_TZ)
    interval_seconds = _get_classroom_sync_interval_seconds(now_k)
    logger.info(
        "Classroom smart auto-sync worker started; adaptive interval=%ds (%.1f min) [Kyiv time: %s], first cycle in 45 seconds",
        interval_seconds,
        interval_seconds / 60.0,
        now_k.strftime("%H:%M"),
    )
    await asyncio.sleep(45)  # Перший запуск через 45 секунд після старту сервера (після стартового автоімпорту розкладу)
    first_cycle = True
    last_health_check_date = None
    while True:
        try:
            now_k = datetime.now(KYIV_TZ)
            # Щоденна перевірка здоров'я токенів о 06:00 ранку
            if now_k.hour == 6 and last_health_check_date != now_k.date():
                try:
                    await perform_daily_credentials_health_check()
                except Exception as hc_err:
                    logger.warning(f"Classroom health check error: {hc_err}")
                last_health_check_date = now_k.date()

            await sync_all_connected_groups_once(force=first_cycle)
            first_cycle = False
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Classroom auto-sync loop error: {_sanitize_error_msg(str(e))}")
        now_k = datetime.now(KYIV_TZ)
        interval_seconds = _get_classroom_sync_interval_seconds(now_k)
        try:
            async with async_session_factory() as hb_db:
                hb = await _read_classroom_heartbeat(hb_db) or {}
                hb["next_interval_s"] = interval_seconds
                hb["next_run_at"] = _iso_utc(datetime.now(timezone.utc) + timedelta(seconds=interval_seconds))
                await _write_classroom_heartbeat(hb_db, hb)
        except Exception:
            pass
        logger.info(
            "Classroom smart auto-sync sleeping for %ds (%.1f min) until next cycle [Kyiv time: %s]",
            interval_seconds,
            interval_seconds / 60.0,
            now_k.strftime("%H:%M"),
        )
        await asyncio.sleep(interval_seconds)
