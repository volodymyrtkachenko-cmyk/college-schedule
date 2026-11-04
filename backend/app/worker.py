import asyncio
import logging

from app.routers.admin_import import schedule_auto_import_loop
from app.routers.classroom import classroom_auto_sync_loop


async def run() -> None:
    await asyncio.gather(
        classroom_auto_sync_loop(),
        schedule_auto_import_loop(),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
