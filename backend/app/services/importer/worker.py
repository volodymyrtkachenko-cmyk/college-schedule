"""Background auto-import loop, scheduling calculations, and stale data pruning."""

import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import KYIV_TZ, now_local
from app.database import async_session_factory
from app.models import ImportedScheduleChange, ScheduleDraft, TokenBlocklist
from app.models.entities import SchedulePublication, SchedulePublicationSnapshot
from app.services.importer.orchestrator import execute_import_logic
from app.services.settings import settings_service

logger = logging.getLogger(__name__)


def get_next_auto_import_target(now_kyiv: Optional[datetime] = None) -> datetime:
    """
    Повертає точний час наступного запуску автоімпорту розкладу коледжу:
    - 05:00 ранку перед парами в робочі дні (Понеділок..П'ятниця)
    - 20:00 ввечері перед наступним робочим днем (Неділя..Четвер)
    У п'ятницю ввечері, суботу (весь день) та неділю вдень автоімпорт спить.
    """
    if now_kyiv is None:
        now_kyiv = datetime.now(KYIV_TZ)

    candidates = []
    for day_offset in range(8):
        day_dt = (now_kyiv + timedelta(days=day_offset)).date()
        weekday = day_dt.weekday()  # 0=Mon..4=Fri, 5=Sat, 6=Sun

        # 1. 05:00 у робочі дні (Пн-Пт)
        if weekday in (0, 1, 2, 3, 4):
            slot_05 = datetime(day_dt.year, day_dt.month, day_dt.day, 5, 0, 0, tzinfo=KYIV_TZ)
            if slot_05 > now_kyiv:
                candidates.append(slot_05)

        # 2. 20:00 перед робочими днями (Нд, Пн, Вт, Ср, Чт)
        if weekday in (6, 0, 1, 2, 3):
            slot_20 = datetime(day_dt.year, day_dt.month, day_dt.day, 20, 0, 0, tzinfo=KYIV_TZ)
            if slot_20 > now_kyiv:
                candidates.append(slot_20)

    candidates.sort()
    return candidates[0]


def get_next_auto_import_delay_seconds(now_kyiv: Optional[datetime] = None) -> int:
    if now_kyiv is None:
        now_kyiv = datetime.now(KYIV_TZ)
    target = get_next_auto_import_target(now_kyiv)
    return max(60, int((target - now_kyiv).total_seconds()))


async def prune_stale_data(db: AsyncSession) -> dict:
    """Очищення застарілих чернеток, знімків публікацій та старих логів замін для оптимізації БД."""
    now_utc = datetime.now(timezone.utc)
    cutoff_drafts = now_utc - timedelta(days=45)
    cutoff_changes_date = (now_utc - timedelta(days=60)).date()
    cutoff_pub_time = now_utc - timedelta(days=60)
    cutoff_tokens = now_utc - timedelta(days=7)

    stats = {
        "pruned_drafts": 0,
        "pruned_changes": 0,
        "pruned_snapshots": 0,
        "pruned_tokens": 0,
    }

    try:
        # 1. Видалення відхилених, архівованих або застосованих чернеток старіших за 45 днів
        drafts_del = await db.execute(
            delete(ScheduleDraft).where(
                ScheduleDraft.status.in_(["rejected", "archived", "applied", "discarded"]),
                ScheduleDraft.created_at < cutoff_drafts,
            )
        )
        stats["pruned_drafts"] = drafts_del.rowcount or 0

        # 2. Видалення старих неопублікованих змін розкладу старіших за 60 днів
        changes_del = await db.execute(
            delete(ImportedScheduleChange).where(
                ImportedScheduleChange.date < cutoff_changes_date,
                ImportedScheduleChange.is_published == False,
            )
        )
        stats["pruned_changes"] = changes_del.rowcount or 0

        # 3. Видалення старих знімків публікацій старіших за 60 днів (залишаючи щонайменше 5 останніх публікацій)
        latest_pub_ids = (
            await db.scalars(
                select(SchedulePublication.id)
                .order_by(SchedulePublication.id.desc())
                .limit(5)
            )
        ).all()
        old_pub_ids_query = select(SchedulePublication.id).where(
            SchedulePublication.timestamp < cutoff_pub_time
        )
        if latest_pub_ids:
            old_pub_ids_query = old_pub_ids_query.where(
                SchedulePublication.id.not_in(latest_pub_ids)
            )
        old_pub_ids = (await db.scalars(old_pub_ids_query)).all()
        if old_pub_ids:
            snaps_del = await db.execute(
                delete(SchedulePublicationSnapshot).where(
                    SchedulePublicationSnapshot.publication_id.in_(old_pub_ids)
                )
            )
            stats["pruned_snapshots"] = snaps_del.rowcount or 0

        # 4. Видалення старих токенів блокування (> 7 днів)
        try:
            tokens_del = await db.execute(
                delete(TokenBlocklist).where(TokenBlocklist.created_at < cutoff_tokens)
            )
            stats["pruned_tokens"] = tokens_del.rowcount or 0
        except Exception:
            pass

        # 5. Очищення пам'яті active users в analytics
        try:
            import time as _t
            from app.analytics import ACTIVE_WINDOW, _active_users
            now_wall = _t.time()
            expired_keys = [
                k for k, v in list(_active_users.items())
                if now_wall - (v.get("last_seen", 0) if isinstance(v, dict) else v) > ACTIVE_WINDOW * 3
            ]
            for k in expired_keys:
                _active_users.pop(k, None)
        except Exception:
            pass

        await db.commit()
        if any(stats.values()):
            logger.info("Data pruning complete: %s", stats)
    except Exception as e:
        logger.warning("Data pruning error: %s", e)
        await db.rollback()

    return stats


async def schedule_auto_import_loop() -> None:
    """Фоновий цикл: розумно перевіряє сайт коледжу о 05:00 ранку (Пн-Пт) та о 20:00 ввечері (Нд-Чт) перед парами."""
    await asyncio.sleep(45)  # 45 секунд після старту сервера для завершення ініціалізації

    first_cycle = True
    while True:
        try:
            now_k = datetime.now(KYIV_TZ)
            next_target = get_next_auto_import_target(now_k)
            delay = get_next_auto_import_delay_seconds(now_k)

            # На першому старті: якщо сервер щойно перезапустився прямо під час цільового вікна (наприклад, 05:00-05:20 або 20:00-20:20) — запускаємо одразу
            should_run_now = False
            if first_cycle:
                first_cycle = False
                cur_min = now_k.hour * 60 + now_k.minute
                is_morning_slot = now_k.weekday() in (0, 1, 2, 3, 4) and (5 * 60 <= cur_min < 5 * 60 + 20)
                is_evening_slot = now_k.weekday() in (6, 0, 1, 2, 3) and (20 * 60 <= cur_min < 20 * 60 + 20)
                should_run_now = is_morning_slot or is_evening_slot

            if not should_run_now:
                logger.info(
                    "Auto-import: sleeping until next scheduled run at %s (in %.1f hours / %d seconds) [Kyiv: %s]",
                    next_target.strftime("%a %Y-%m-%d %H:%M"),
                    delay / 3600.0,
                    delay,
                    now_k.strftime("%H:%M"),
                )
                await asyncio.sleep(delay)

            async with async_session_factory() as db:
                logger.info("Auto-import: executing scheduled check from college site...")
                result = await execute_import_logic(db=db, weeks=2, actor_id=None)
                meta = result.get("meta", {})
                if meta.get("unchanged"):
                    logger.info("Auto-import: schedule on college site is unchanged.")
                elif meta.get("auto_published"):
                    logger.info("Auto-import: changes auto-published successfully.")
                elif meta.get("is_anomaly"):
                    logger.warning("Auto-import: anomaly detected, left as draft for admin review.")

                await prune_stale_data(db)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"Auto-import cycle error: {e}")
            try:
                async with async_session_factory() as err_db:
                    err_detail = getattr(e, "detail", str(e))
                    if isinstance(err_detail, dict):
                        err_msg = err_detail.get("message") or err_detail.get("msg") or str(err_detail)
                    else:
                        err_msg = str(err_detail)
                    await settings_service.set(
                        err_db,
                        "import_last_check_status",
                        json.dumps({
                            "checked_at": now_local().isoformat(),
                            "source": "Авто",
                            "status": "error",
                            "error_message": err_msg[:120],
                            "changes_count": 0,
                        }),
                    )
                    await err_db.commit()
            except Exception:
                pass
            await asyncio.sleep(300)
