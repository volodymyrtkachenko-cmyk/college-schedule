# Backend Rules (`backend/`)

1. **Односпрямована архітектура (`routers → services → models/core`)**:
   - Роутери (`app/routers/*`) відповідають лише за HTTP, DI (`Depends`), перевірку прав, rate limiting та виклик сервісів.
   - Заборонено імпортувати з одного роутера в інший або з `app/services/*` у `app/routers/*`.
   - Спільні утиліти брати з `app/core/` (`time.py` для `KYIV_TZ`, `rate_limit.py` для `limiter`, `crypto.py`, `security.py`), Pydantic-схеми — з `app/schemas/`, бізнес-логіку — з `app/services/`.

2. **Кешування, ETag та фонові воркери**:
   - Не обходити слухачі інвалідації кешу (`bump_updated_at`); усі зміни розкладу, замін, дзвінків чи налаштувань мають коректно оновлювати ревізію/ETag.
   - Не змінювати існуючі URL-шляхи, методи, формати JSON-відповідей та ETag-заголовки без прямої потреби.
   - Фонові цикли (`classroom_auto_sync_loop`, `schedule_auto_import_loop`) живуть у сервісному шарі (`services/classroom/worker.py`, `services/importer/worker.py`) і підключаються в `app/main.py` та `app/worker.py`.

3. **Тестування та міграції**:
   - Обов'язковий прогін перед комітом: `cd backend && ../.venv/bin/pytest -q`.
   - Усі зміни схеми БД та індекси оформлювати міграціями Alembic (`backend/alembic/`).
