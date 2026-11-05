# Детальний план оптимізації та виправлення швидкодії проекту `college-schedule`

Цей документ містить результати повного технічного аудиту кодової бази (`backend`, `frontend`, схеми БД, міграцій та конфігурацій деплою) і покроковий план оптимізації швидкодії без порушення існуючих API-контрактів та бізнес-логіки.

---

## Етап 1. Дослідження структури та архітектури проекту

### 1.1. Карта проекту, точки входу, залежності та інфраструктура

```text
college-schedule/
├── .github/workflows/
│   ├── fly-deploy.yml                # CI/CD: деплой бекенду на Fly.io (working-directory: ./backend)
│   └── python-app.yml                # CI/CD: pytest + деплой бекенду на Heroku (college-schedule-api)
├── docker-compose.yml                # Локальне середовище: PostgreSQL 16 + backend (:8000) + frontend (:3000)
├── backend/
│   ├── Dockerfile                    # python:3.12-slim, інсталяція requirements.txt, запуск entrypoint.sh
│   ├── entrypoint.sh                 # Запуск alembic upgrade head + uvicorn app.main:app (1 воркер)
│   ├── Procfile                      # Конфігурація для Heroku/Railway: web (uvicorn) + worker (python -m app.worker)
│   ├── fly.toml                      # Конфігурація Fly.io: регіон fra (Франкфурт), 2 vCPU / 1 GB RAM, auto_stop='stop'
│   ├── requirements.txt              # FastAPI 0.115.11, SQLAlchemy 2.0.38, asyncpg 0.30.0, ortools 9.15, pwdlib[argon2], httpx
│   ├── alembic/
│   │   ├── env.py                    # Конфігурація міграцій (async_engine_from_config)
│   │   └── versions/                 # 32 файли міграцій (остання: 20261102_add_academic_terms.py)
│   └── app/
│       ├── main.py                   # Точка входу FastAPI, lifespan, GZipMiddleware, CORS, bootstrap індексів/послідовностей
│       ├── worker.py                 # Окремий фоновий процес для classroom_auto_sync_loop та schedule_auto_import_loop
│       ├── config.py                 # Налаштування Pydantic Settings (DATABASE_URL, RUN_SCHEMA_BOOTSTRAP, JWT, Google OAuth)
│       ├── database.py               # create_async_engine (pool_size=5, max_overflow=10, pool_recycle=300)
│       ├── analytics.py              # In-memory трекінг активних сесій (_active_users, TTL 5 хв) для /api/ping
│       ├── core/security.py          # Argon2 хешування паролів (pwdlib), JWT токени (PyJWT)
│       ├── models/
│       │   ├── entities.py           # Основні ORM-моделі (27 таблиць)
│       │   ├── lesson_notes.py       # Модель LessonOccurrenceNote (нотатки до пар та завдання Classroom)
│       │   └── bump_updated_at.py    # ORM-хук before_flush для оновлення ScheduleVersion.updated_at
│       ├── routers/                  # 20 модулів маршрутизації API (schedule, directory, classroom, drafts, admin_import тощо)
│       └── services/                 # Бізнес-логіка: projection.py, lesson_notes.py, classroom_access.py, learning_mode.py, solver.py
└── frontend/
    ├── Dockerfile                    # node:20-alpine, dev-сервер npm run dev
    ├── package.json                  # Next.js 14.2.24, React 18.3.1, framer-motion 11.0.8, lucide-react, @ducanh2912/next-pwa 10.2.9
    ├── next.config.mjs               # Конфігурація Next.js + PWA Service Worker (public/sw.js)
    ├── app/
    │   ├── layout.tsx                # Кореневий layout, AuthProvider, Heartbeat, SplashScreen, Google GSI скрипт
    │   ├── page.tsx                  # Головний екран розкладу (мобільний DayPager / десктопний ScheduleWeekGrid + сайдбар ДЗ)
    │   ├── admin/page.tsx            # Адмін-панель (редактор розкладу, імпорт, чернетки, довідники, генератор)
    │   ├── statistics/page.tsx       # Сторінка аналітики та статистики годин
    │   ├── educational-process/page.tsx # Графік освітнього процесу
    │   └── settings/page.tsx         # Налаштування користувача та теми
    ├── components/                   # UI-компоненти: LessonCard, ScheduleDay, ScheduleWeekGrid, DayPager, MobileTasksView тощо
    └── lib/
        ├── api.ts                    # HTTP-клієнт з підтримкою ETag (etagCache), дедуплікацією in-flight запитів та groupStatusCache
        ├── hooks.ts                  # Хук useSchedule (memoryCache + localStorage + prefetchAdjacentWeeks)
        ├── useClassroomSubmissions.ts# Хук синхронізації персональних статусів здачі ДЗ студента
        └── useTaskGroups.ts          # Групування та фільтрація завдань Classroom за тижнями
```

### 1.2. Як зчитуються та віддаються дані розкладу

1. **Клієнтський запит**:
   - При відкритті головної сторінки (`frontend/app/page.tsx`) хук `useSchedule()` (`frontend/lib/hooks.ts:127-370`) перевіряє локальний кеш (`memoryCache` з TTL 5 хв та `localStorage`) і викликає `api.week()` (`GET /api/schedule/week`) для тижневого режиму або `api.today()` (`GET /api/schedule/today`) для денного.
   - Через 350 мс після отримання відповіді `useSchedule` автоматично запускає `prefetchAdjacentWeeks()` (`frontend/lib/hooks.ts:232-253`, `341`), виконуючи ще 2 фонові запити `GET /api/schedule/week` для попереднього (`-7` днів) та наступного (`+7` днів) тижня.
2. **Обробка на бекенді (`backend/app/routers/schedule.py`)**:
   - Ендпоінти `/api/schedule` (`schedule.py:139-227`), `/api/schedule/today` (`schedule.py:258-334`) та `/api/schedule/week` (`schedule.py:337-492`) використовують SQLAlchemy 2.0 Async ORM (`AsyncSession` поверх `asyncpg`). Сирі SQL-запити використовуються лише під час старту в `main.py:44-125` та в міграціях Alembic.
   - Спочатку перевіряється доступ до посилань на онлайн-пари через `resolve_schedule_link_access()` (`backend/app/services/classroom_access.py:157-212`), який виконує запити до `AppSetting` (`teacher_Unlock_pin_hash`), `ClassroomGroupBinding`, `ClassroomCredential` та `GroupStudent`.
   - Далі викликається ядро побудови розкладу — `build_projection()` (`backend/app/services/projection.py:163-358`) або `build_week_projection()` (`projection.py:514-697`).
3. **Побудова проекції розкладу (`backend/app/services/projection.py`)**:
   - Перевіряється in-memory кеш воркера `_DAY_PROJ_CACHE` або `_WEEK_PROJ_CACHE` (`projection.py:29-30`, TTL 45 с, ключ включає `get_schedule_cache_rev()`, який інкрементується при будь-якому записі в БД через `main.py:182-186`).
   - При промаху кешу виконується серія запитів до БД:
     1. Активні версії розкладу `ScheduleVersion` на цільову дату/діапазон (`projection.py:224`, `570`).
     2. Періоди практики/канікул `SchedulePeriod` з `selectinload(SchedulePeriod.groups)` (`projection.py:232`, `584`).
     3. Базові слоти розкладу `Schedule` з `selectinload` для `group`, `subject`, `teacher`, `teacher2` (`projection.py:250`, `604`).
     4. Імпортовані заміни `ImportedScheduleChange` та снепшоти публікацій `PublishedGroupSnapshot` з активних `SchedulePublication` (`projection.py:725-830`).
     5. Ручні перенесення та скасування `ScheduleOverride` на діапазон дат ±14 днів (`projection.py:361-425`).
     6. Базові посилання на онлайн-пари `SubjectGroupLink` (`projection.py:900-934`).
4. **Пост-обробка після кешу проекції (`attach_notes`, `learning_mode`, `_active_periods`, `ETag`)**:
   - Навіть при влучанні в `_DAY_PROJ_CACHE` / `_WEEK_PROJ_CACHE`, роутер на **кожному** запиті викликає:
     - `attach_notes(db, lessons)` (`backend/app/services/lesson_notes.py:114-184`), який виконує 2 запити до БД (`LessonOccurrenceNote` та повторний `ScheduleOverride`).
     - `resolve_group_learning_mode_detail()` (`backend/app/services/learning_mode.py:93-155`), який визначає формат навчання (очно/дистанційно) за курсом групи.
     - Повторну перевірку активних практик `_active_periods(db, target_date)` (`schedule.py:250`, `474-482`).
     - Фільтрацію онлайн-посилань `_apply_link_visibility()` (`schedule.py:117-136`).
     - Обчислення SHA-256 `ETag` з JSON-відповіді (`schedule.py:230-238`, `300-305`, `379-384`).

### 1.3. Файли, які не були прочитані повністю, та причина

| Файл / Директорія | Причина пропуску повного читання |
|---|---|
| `backend/app/services/solver.py` | Містить математичну модель CP-SAT (Google OR-Tools) для офлайн-генерації розкладу адміністратором раз на семестр. Не бере участі в обробці призначених для користувача HTTP-запитів розкладу чи синхронізації Classroom. |
| `backend/tests/*` та `frontend/tests/*` | Автоматизовані тести (`pytest` та `node:test`). Не впливають на runtime-швидкодію production-коду. |
| Історичні міграції `backend/alembic/versions/0001..20260417_*.py` | Поточний стан схеми БД повністю відображений у `backend/app/models/entities.py`, `backend/app/models/lesson_notes.py`, останніх міграціях `20261018_perf_composite_indexes.py`, `20261102_add_academic_terms.py` та DDL-блоці `backend/app/main.py:44-96`. |
| `frontend/public/workbox-f1770938.js`, `frontend/public/*.png` | Згенерований мініфікований бандл бібліотеки Workbox та бінарні растрові іконки PWA (логіка кешування Service Worker повністю проаналізована в `frontend/public/sw.js` та `frontend/next.config.mjs`). |

---

## 1. Короткий висновок: поточний стан і 5 головних проблем

Проект вже має солідну базову архітектуру: асинхронний драйвер `asyncpg`, `selectinload` в основних запитах розкладу, in-memory кешування проекцій (`_DAY_PROJ_CACHE`, `_WEEK_PROJ_CACHE`), генерацію `ETag` та клієнтський кеш у `localStorage`. Однак через низку архітектурних помилок на стику фронтенду, бекенду та БД більшість цих механізмів кешування **фактично нейтралізовані**.

### Топ-5 критичних проблем швидкодії:
1. **Повне руйнування HTTP/CDN та ETag кешування розкладу**:
   - На бекенді в `backend/app/routers/schedule.py:304,383` виставлено заголовок `Vary: Date, ...`. Оскільки HTTP-заголовок `Date` змінюється щосекунди, жоден CDN/Reverse Proxy не може використати `s-maxage=15`.
   - На фронтенді `attachClassroomQueryParams()` (`frontend/lib/api.ts:427-438`) додає персональні `classroom_user_id`, `classroom_email` та `teacher_pin` прямо в URL query-параметри `/api/schedule/today` і `/api/schedule/week`, роблячи URL унікальним для кожного студента, тоді як заголовки `X-Classroom-Email` / `X-Classroom-User-Id` взагалі ніколи не відправляються через друкарську помилку в ключах `localStorage` (`schedule_classroom_...` з підкресленням замість двокрапки `schedule:classroom_...` у `frontend/lib/api.ts:469-475`).
   - При кожному перемиканні вкладки (`visibilitychange`) `frontend/app/page.tsx:289` викликає `invalidateScheduleCache()`, яка примусово очищує `etagCache` (`frontend/lib/hooks.ts:13`), унеможливлюючи швидку відповідь `304 Not Modified`.
2. **Зайві запити до БД на гарячому шляху `/api/schedule*` навіть при влучанні в in-memory кеш**:
   - `attach_notes()` (`backend/app/services/lesson_notes.py:137-148`) викликається поза кешем проекції на кожному запиті і щоразу виконує 2 запити до БД: вибірку нотаток і дублюючу вибірку `ScheduleOverride` (яку вже виконала `build_projection`).
   - Роутер `schedule.py:202,250,311,474` повторно запитує `SchedulePeriod` (вже завантажені в `build_projection`) та двічі завантажує `Group` по `db.get(Group, group_id)`.
   - `check_classroom_group_access()` (`backend/app/services/classroom_access.py:127,145`) на кожному запиті розкладу з поштою виконує `func.lower(email) == ...` по таблицях `classroom_credentials` та `group_students`, які не мають індексів на `email` (Sequential Scan).
3. **Критичні складені індекси відсутні в моделях та міграціях Alembic**:
   - П'ять головних індексів продуктивності (`ix_schedule_active_lookup`, `ix_imp_changes_lookup`, `ix_override_date_group`, `ix_notes_week_lookup`, `ix_snapshots_pub_group`) створюються лише в `backend/app/main.py:58-90` за умови `RUN_SCHEMA_BOOTSTRAP=true` (який за замовчуванням у `backend/app/config.py:44` дорівнює `False`!). У `models/entities.py` та у файлах `alembic/versions/` цих індексів немає.
4. **Шторм запитів з фронтенду (3× `prefetchAdjacentWeeks`, подвійний рефетч на `visibilitychange`, подвійний `/api/ping`)**:
   - Кожне завантаження розкладу тижня через 350 мс безумовно тягне ще 2 сусідні тижні (`frontend/lib/hooks.ts:232-253`), потроюючи навантаження на бекенд і БД.
   - Повернення користувача на вкладку (`visibilitychange`) одночасно тригерить два слухачі в `page.tsx:287` і `hooks.ts:358`, `ClassroomSyncButton.tsx:291` та `Heartbeat.tsx:80`, генеруючи пачку з 5–7 паралельних запитів після попереднього знищення локального кешу.
5. **Блокування asyncio event loop та необмежені вибірки у фонових процесах і адмінці**:
   - Синхронне CPU-важке хешування Argon2 (`pwd_context.verify` / `hash`, ~50–150 мс) викликається прямо в `async def` ендпоінтах (`backend/app/routers/auth.py:97`, `users.py:71,101`), блокуючи єдиний воркер Uvicorn для всіх користувачів.
   - Синхронізація Classroom (`backend/app/routers/classroom.py:918-925, 968-976`) завантажує всі історичні `LessonOccurrenceNote` групи без фільтрації за датою/архівом і сканує всю таблицю через `LIKE '%[TASK%'`, а також зберігає сирі об'єкти `httpx.Response` у RAM на 12 годин (`classroom.py:1219,1233`).

---

## 2. Таблиця знахідок (Бекенд, БД, Фронтенд, PWA, Інфраструктура)

| № | Місце (`файл:рядок`) | Проблема | Вплив | Складність | Рекомендація |
|---|---|---|---|---|---|
| **1** | `backend/app/main.py:58-90`<br>`backend/app/config.py:44`<br>`backend/alembic/versions/20261018_perf_composite_indexes.py:19-46` | 5 критичних складених індексів (`ix_schedule_active_lookup`, `ix_imp_changes_lookup`, `ix_override_date_group`, `ix_notes_week_lookup`, `ix_snapshots_pub_group`) створюються лише при `RUN_SCHEMA_BOOTSTRAP=true` (дефолт `False`) і відсутні в Alembic-міграціях та `entities.py`. | **Високий** | Низька | Перенести всі 5 індексів (плюс нові індекси з п. 2–3) у повноцінну міграцію Alembic та задекларувати в `__table_args__` моделей. |
| **2** | `backend/app/services/classroom_access.py:127,145`<br>`backend/app/models/entities.py:492,522` | Запити `func.lower(ClassroomCredential.email) == ...` та `func.lower(GroupStudent.email) == ...` виконуються на кожному запиті розкладу без індексів на `email`. | **Високий** | Низька | Додати функціональні індекси `ix_classroom_cred_lower_email` та `ix_group_students_lower_email` через Alembic. |
| **3** | `backend/app/models/entities.py:171,378,418` | Відсутні індекси на `schedule_drafts(draft_type, status)`, `schedule_publications(is_reverted, id)` та `schedule_override(group_id, moved_to_date, moved_to_lesson)`. | **Середній** | Низька | Додати складені індекси в Alembic-міграцію та моделі `ScheduleDraft`, `SchedulePublication`, `ScheduleOverride`. |
| **4** | `backend/app/routers/schedule.py:304,383` | Заголовок `Vary: Date, Origin, ...` у відповідях `/api/schedule/today` та `/api/schedule/week` робить неможливим кешування на CDN/проксі (`s-maxage=15`), бо `Date` змінюється щосекунди. | **Високий** | Низька | Прибрати `Date` зі списку `Vary`. Для відповідей з персональними посиланнями ставити `Cache-Control: private, no-cache`. |
| **5** | `frontend/lib/api.ts:427-438, 469-475`<br>`frontend/lib/useClassroomSubmissions.ts:12-13` | Друкарська помилка в ключах `localStorage` (`schedule_classroom_...` замість `schedule:classroom_...`) призводить до того, що заголовки `X-Classroom-*` ніколи не шлються, а `attachClassroomQueryParams()` додає email/user_id/pin у URL query-параметри, руйнуючи кешування та світячи PII в URL. | **Високий** | Низька | Виправити ключі в `api.ts:469-470` на `schedule:classroom_...`, передавати дані лише через заголовки `X-Classroom-*` та прибрати їх з URL query-параметрів. |
| **6** | `backend/app/services/lesson_notes.py:114-184`<br>`backend/app/routers/schedule.py:181,288,370` | `attach_notes()` викликається на кожному запиті навіть при хіті `_DAY_PROJ_CACHE`/`_WEEK_PROJ_CACHE` і щоразу робить 2 SQL-запити: `LessonOccurrenceNote` та дублюючий `ScheduleOverride`. | **Високий** | Середня | Включити `attach_notes()` всередину кешованої проекції (`build_projection` / `build_week_projection`) і передавати вже завантажені `overrides`, усунувши обидва запити при хіті кешу. |
| **7** | `backend/app/routers/schedule.py:202,250,311,474-482`<br>`backend/app/services/learning_mode.py:110` | Повторне завантаження `Group` (`db.get(Group, group_id)` двічі за запит у `/schedule` та `/today`) та повторний запит `SchedulePeriod` (який вже виконано в `build_projection`). | **Середній** | Низька | Передавати `group=scope` у `resolve_group_learning_mode_detail()` та повертати активні періоди практики разом із проекцією з кешу. |
| **8** | `backend/app/routers/directory.py:113-184` | `/api/teacher-subjects` (`directory.py:157-184`) не використовує `_DIR_CACHE` і щоразу виконує 2 важкі `SELECT DISTINCT` по таблиці `schedule`. Решта ендпоінтів `/api/groups`, `/teachers`, `/subjects` не віддають `Cache-Control` / `ETag`. | **Середній** | Низька | Обгорнути `/api/teacher-subjects` у `_DIR_CACHE` та додати `Cache-Control: public, max-age=60, stale-while-revalidate=300` для всіх довідників. |
| **9** | `backend/app/routers/schedule_now.py:40,49` | `GET /api/schedule/now` читає `BellSchedule` з БД замість `_bell_cache` і викликає `build_projection(db, target_date=today_date)` для **всього коледжу** без фільтрації за `group_id`/`teacher_id`. | **Середній** | Низька | Використати `_load_bell_map(db)` з кешем та додати опційні параметри `group_id: int \| None = None`, `teacher_id: int \| None = None`. |
| **10** | `backend/app/routers/drafts.py:104, 111-125` | 1) Завантажуються всі рядки `ScheduleDraft` разом із великим JSON-полем `data` (звіти імпорту, снепшоти).<br>2) Для ролі `editor` у циклі `for d in drafts:` виконується N+1 запит `SELECT ScheduleSlot ... selectinload(curriculum)`. | **Високий** | Низька | 1) Використати `.options(defer(ScheduleDraft.data))` у `list_drafts` (або завантажувати лише потрібні ключі JSON).<br>2) Замінити цикл одним батч-запитом `ScheduleSlot.draft_id.in_(...)`. |
| **11** | `backend/app/routers/admin_import.py:1075-1093, 1179-1196, 1424-1433` | Три N+1 цикли під час імпорту розкладу (`_do_import`): поштучні запити `ImportedScheduleChange` на кожну відкочену публікацію, `Schedule` на кожну заміну та `func.max(ImportedScheduleChange.version)` на кожну автопублікацію. | **Високий** | Середня | Замінити поштучні запити в циклах на пакетні вибірки через `.in_()` / `tuple_(...).in_(...)` (як це вже зроблено в `drafts.py:806-824`). |
| **12** | `backend/app/services/lesson_notes.py:195-242`<br>`backend/app/routers/schedule_dated.py:636-750`<br>`backend/app/routers/schedule.py:619-673`<br>`backend/app/routers/schedule_template.py:529-546` | N+1 запити в циклах при перенесенні нотаток (`version_for_date` і `active_note` у циклі), пакетному редагуванні датованих пар (`batch_dated_lessons`), масовому додаванні кураторських годин (`bulk_curator_hours`) та копіюванні дня шаблону. | **Середній** | Середня | Попередньо завантажувати версії розкладу, конфліктні пари та оверрайди одним `SELECT ... WHERE ... IN (...)` перед циклом. |
| **13** | `backend/app/core/security.py:20-25`<br>`backend/app/routers/auth.py:97`<br>`backend/app/routers/users.py:71,101`<br>`backend/app/services/classroom_access.py:56` | Синхронні CPU-bound виклики Argon2 (`pwd_context.verify`, `pwd_context.hash`) та `pbkdf2_hmac` виконуються прямо в `async def` роутах, блокуючи asyncio event loop на 50–150 мс. | **Високий** | Низька | Додати асинхронні обгортки `verify_password_async` / `get_password_hash_async` через `await asyncio.to_thread(...)`. |
| **14** | `backend/app/routers/classroom.py:918-925, 968-976, 1219, 1233` | 1) У `perform_course_sync` завантажуються всі `LessonOccurrenceNote` групи за весь час без фільтра `archived == False` або дати.<br>2) Full table scan з `LIKE '%[TASK%'` на кожній синхронізації.<br>3) У `_course_teachers_cache` та `_course_topics_cache` кешуються повні об'єкти `httpx.Response` замість JSON. | **Високий** | Середня | 1) Додати фільтр `LessonOccurrenceNote.note_date >= today - 30d` у запит синхронізації.<br>2) Обмежити очищення осиротілих нотаток лише поточною групою.<br>3) Кешувати розпарсені `dict` замість `httpx.Response`. |
| **15** | `backend/app/main.py:106-125`<br>`backend/fly.toml:22-24` | На кожному старті контейнера (зокрема після `auto_stop_machines = 'stop'` на Fly.io) послідовно виконуються 11 SQL-запитів `setval(pg_get_serial_sequence(...))`, затримуючи холодний старт на 1–2 с. | **Середній** | Низька | Виконувати синхронізацію sequence лише при `RUN_SCHEMA_BOOTSTRAP=true` або об'єднати всі 11 викликів `setval` в один SQL-запит (`DO $$ ... $$`). |
| **16** | `backend/app/main.py:255` | `GZipMiddleware(minimum_size=500)` використовує дефолтний `compresslevel=9` (максимальне навантаження на CPU при мінімальному виграші в розмірі порівняно з рівнем 5). | **Низький** | Низька | Передати `compresslevel=5` у `app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=5)`. |
| **17** | `backend/app/database.py:21-29` | Пул з'єднань SQLAlchemy не має `pool_timeout` (дефолт 30 с) та `statement_timeout` на рівні сесії PostgreSQL, через що завислий запит може надовго заблокувати пул воркера. | **Середній** | Низька | Встановити `pool_timeout=10` та `connect_args={"command_timeout": 15}` для драйвера `asyncpg`. |
| **18** | `frontend/app/page.tsx:286-297`<br>`frontend/lib/hooks.ts:11-25, 358-366` | При поверненні на вкладку (`visibilitychange`) `page.tsx` викликає `invalidateScheduleCache()`, яка стирає `memoryCache`, `etagCache` та `localStorage` і шле подію `schedule:refresh`. Одночасно `hooks.ts:358` слухає той самий `visibilitychange`, що спричиняє подвійний запит розкладу без ETag (`200 OK` замість `304`). | **Високий** | Низька | Не стирати `etagCache` та `localStorage` при `visibilitychange`; прибрати дублюючий обробник `visibilitychange` з `page.tsx` і додати тротлінг ревалідації (не частіше ніж раз на 60 с). |
| **19** | `frontend/lib/hooks.ts:232-253, 341` | `prefetchAdjacentWeeks()` безумовно завантажує `-7` та `+7` тижні через 350 мс після кожного завантаження поточного тижня, збільшуючи кількість важких запитів `/api/schedule/week` у 3 рази. | **Високий** | Низька | Виконувати префетч сусідніх тижнів лише за умови відсутності їх у `memoryCache`/`localStorage`, збільшити затримку до `requestIdleCallback` (або 1500 мс) і вимикати при `navigator.connection?.saveData`. |
| **20** | `frontend/components/Heartbeat.tsx:70, 105-140` | На старті сторінки `GET /api/ping` викликається двічі поспіль: з першого `useEffect(..., [])` (рядок 70) та з другого `useEffect(..., [user])` (рядок 138, коли `user === null`). | **Низький** | Низька | У другому `useEffect` пропускати початковий рендер через `isFirstRenderRef` і викликати `ping()` лише при реальній зміні `user?.id`. |
| **21** | `frontend/app/page.tsx:24-29`<br>`frontend/components/ScheduleDay.tsx:121-123` | 1) Важкі компоненти вкладок і модалок (`MobileTasksView`, `GradesView`, `TeacherPinModal`, `TaskFilters`) імпортуються статично в `page.tsx`.<br>2) У `ScheduleDay.tsx:121` масив `[...schedule.lessons].sort(...)` сортується на кожному рендері без `useMemo`. | **Середній** | Низька | 1) Перевести другорядні вкладки та модалки на `next/dynamic` (`ssr: false`).<br>2) Обгорнути сортування `lessons` у `ScheduleDay.tsx` в `useMemo`. |
| **22** | `frontend/next.config.mjs:2-13`<br>`frontend/public/sw.js:1`<br>`frontend/lib/api.ts:485` | Workbox у Service Worker має `networkTimeoutSeconds: 10`, тоді як `api.ts:485` перериває запит через `AbortController` за `8500 мс`. При поганому інтернеті `fetch` падає по abort раніше, ніж SW встигає віддати офлайн-кеш! Крім того, cross-origin API кешується в SW лише на 1 годину (`maxAgeSeconds: 3600`, `maxEntries: 32`). | **Високий** | Середня | Налаштувати `workboxOptions.runtimeCaching` у `next.config.mjs`: для `/api/schedule*` встановити `networkTimeoutSeconds: 4` (менше за 8.5 с у `api.ts`) та `maxAgeSeconds: 7 * 24 * 3600`. |
| **23** | `frontend/app/layout.tsx:100`<br>`frontend/components/SplashScreen.tsx:22-54` | 1) `SplashScreen` рендерить повноекранний `fixed inset-0 z-[99999] bg-[var(--bg)]` на 380 мс поверх контенту, штучно затримуючи LCP на ~400 мс.<br>2) Скрипт `accounts.google.com/gsi/client` завантажується глобально на всіх сторінках зі стратегією `afterInteractive`. | **Середній** | Низька | 1) Показувати `SplashScreen` лише у standalone PWA-режимі (`window.matchMedia('(display-mode: standalone)').matches`), не блокуючи LCP у звичайному браузері.<br>2) Завантажувати Google GSI зі стратегією `lazyOnload`. |
| **24** | `backend/fly.toml:14, 22-24, 30`<br>`backend/entrypoint.sh:16`<br>`backend/Procfile:1-2` | 1) У `fly.toml` виділено 2 vCPU, але `entrypoint.sh` запускає лише 1 воркер Uvicorn, у якому також крутяться фонові цикли `RUN_CRON=true`.<br>2) `min_machines_running = 0` зупиняє контейнер уночі та на перервах, спричиняючи холодні старти по 3–5 с. | **Високий** | Середня | Відокремити фоновий воркер (`python -m app.worker`), тримати `min_machines_running = 1` у навчальні години та узгодити регіон Fly.io (`fra`) з регіоном керованої PostgreSQL. |

---

## 3. Пріоритизований план виправлень у трьох хвилях

### Хвиля 1: Швидкі виграші (1–2 дні, максимальний ефект без зміни архітектури)
1. **Х1.1. Міграція індексів БД (Alembic)**: зафіксувати 5 складених індексів із `main.py` та додати 5 нових індексів (`lower(email)` для Classroom, `schedule_drafts`, `schedule_publications`, `schedule_override`).
2. **Х1.2. Відновлення HTTP/CDN та ETag кешування розкладу**:
   - Прибрати `Date` із заголовка `Vary` у `backend/app/routers/schedule.py`.
   - Виправити друкарську помилку ключів `localStorage` у `frontend/lib/api.ts:469-470` (`schedule:classroom_...`) та прибрати `attachClassroomQueryParams()` з URL розкладу.
   - Додати `Cache-Control` заголовки та кешування `_DIR_CACHE` для `/api/teacher-subjects` у `backend/app/routers/directory.py`.
3. **Х1.3. Усунення зайвих SQL-запитів на гарячому шляху `/api/schedule*`**:
   - Внести `attach_notes()` всередину `_DAY_PROJ_CACHE` / `_WEEK_PROJ_CACHE` та передавати вже завантажені `overrides` замість повторного запиту `ScheduleOverride`.
   - Передавати `group=scope` у `resolve_group_learning_mode_detail()` (прибирає повторний `db.get(Group)`).
   - Повертати активні періоди практики з кешу проекції замість повторного виклику `_active_periods()`.
   - Використати `_load_bell_map()` та фільтри `group_id`/`teacher_id` у `GET /api/schedule/now`.
4. **Х1.4. Усунення N+1 запитів та важких полів**:
   - `defer(ScheduleDraft.data)` та батч-запит `ScheduleSlot` у `backend/app/routers/drafts.py`.
   - Батч-запити замість циклів у `backend/app/routers/admin_import.py` та `backend/app/services/lesson_notes.py`.
5. **Х1.5. Винесення Argon2 / PBKDF2 у пул потоків (`asyncio.to_thread`)**:
   - Розблокувати asyncio event loop під час логіну та перевірки PIN-коду викладача.
6. **Х1.6. Припинення шторму запитів на фронтенді**:
   - Прибрати знищення `etagCache` і `localStorage` при `visibilitychange`, усунути подвійний слухач `visibilitychange` та додати 60-секундний cooldown.
   - Оптимізувати `prefetchAdjacentWeeks()` (префетчити лише при відсутності в кеші, через `requestIdleCallback` / 1500 мс) та прибрати подвійний виклик `/api/ping` при монтуванні `Heartbeat.tsx`.

### Хвиля 2: Середні зміни (3–5 днів)
1. **Х2.1. Оптимізація пулу з'єднань БД, таймаутів та стиснення**:
   - У `backend/app/database.py`: додати `pool_timeout=10` та `connect_args={"command_timeout": 15}`.
   - У `backend/app/main.py`: об'єднати 11 стартових `setval`-запитів в один блок `DO $$ ... $$` (або запускати лише при `RUN_SCHEMA_BOOTSTRAP=true`) та змінити `GZipMiddleware(minimum_size=500, compresslevel=5)`.
2. **Х2.2. Оптимізація пам'яті та SQL-запитів синхронізації Google Classroom**:
   - У `backend/app/routers/classroom.py:918-925`: обмежити вибірку `LessonOccurrenceNote` активними записами та вікном дат.
   - У `backend/app/routers/classroom.py:968-976`: прибрати глобальний full-table scan `LIKE '%[TASK%'` по всіх групах на кожному синку курсу.
   - У `backend/app/routers/classroom.py:1219,1233`: зберігати у `_course_teachers_cache` та `_course_topics_cache` розпарсені `dict` замість об'єктів `httpx.Response`.
3. **Х2.3. Code Splitting, мемоізація та Core Web Vitals (LCP/INP) на фронтенді**:
   - Динамічний імпорт (`next/dynamic`) для `MobileTasksView`, `GradesView`, `TeacherPinModal`, `TaskFilters` у `frontend/app/page.tsx`.
   - Мемоізація сортування уроків у `frontend/components/ScheduleDay.tsx:121`.
   - Показ `SplashScreen` лише в standalone PWA-режимі та переведення Google GSI скрипта на `strategy="lazyOnload"`.
4. **Х2.4. Узгодження PWA Service Worker (Workbox) із таймаутами API**:
   - Налаштувати `runtimeCaching` у `frontend/next.config.mjs`: `networkTimeoutSeconds: 4` для API розкладу (щоб SW встигав віддати офлайн-кеш до спрацювання 8.5-секундного `AbortController` у `api.ts`) та збільшити TTL кешу розкладу в SW до 7 днів.

### Хвиля 3: Архітектурні та інфраструктурні зміни (1–2 тижні)
1. **Х3.1. Розділення Web та Background Worker процесів**:
   - Вимкнути `RUN_CRON=false` у веб-воркерах Uvicorn і винести `classroom_auto_sync_loop` та `schedule_auto_import_loop` в окремий процес `python -m app.worker` (або окрему групу процесів `processes` у `fly.toml`).
   - Це дозволить безпечно запустити 2 воркери Uvicorn (`--workers 2`) на 2-vCPU машині без дублювання фонових синхронізацій.
2. **Х3.2. Спільний кеш / інвалідація між воркерами**:
   - При роботі з `--workers 2` in-memory кеші (`_DAY_PROJ_CACHE`, `_WEEK_PROJ_CACHE`, `_DIR_CACHE`, `_active_users`) стають ізольованими в кожному процесі.
   - Варіант А (без нових сервісів): використати PostgreSQL `LISTEN / NOTIFY` на канал `schedule_cache_invalidate`, щоб при зміні розкладу в одному воркері всі інші воркери миттєво викликали `bump_schedule_cache_rev()`.
   - Варіант Б (при масштабуванні): підключити Upstash Redis / Fly Redis для спільного зберігання проекцій розкладу та сесій аналітики.
3. **Х3.3. Хостинг, географія та усунення холодних стартів**:
   - Перевірити та забезпечити розміщення бекенду (`fly.toml: primary_region = 'fra'`) і керованої БД PostgreSQL (Neon / Supabase) **в одному датацентрі/регіоні** (`eu-central-1` / Франкфурт). Якщо БД і бекенд у різних регіонах, кожен із 6–8 послідовних SQL-запитів додає 15–40 мс мережевої затримки (сумарно +100–300 мс на запит).
   - Встановити `min_machines_running = 1` у `backend/fly.toml` (або перенести бекенд + PostgreSQL на єдиний VPS Hetzner Falkenstein/Nuremberg `CX22`), що повністю усуне холодні старти та міжсерверний RTT між бекендом і БД (<0.2 мс через локальний сокет).

---

## 4. Детальна реалізація Хвилі 1: приклади коду «Було / Стало» та перевірка ефекту

### Х1.1. Міграція індексів БД (Alembic) з описом відкату

**Проблема**: Індекси з `backend/app/main.py:58-90` не виконуються при `RUN_SCHEMA_BOOTSTRAP=false`, а таблиці `classroom_credentials`, `group_students`, `schedule_drafts`, `schedule_publications` та `schedule_override` не мають індексів для частих фільтрів.

#### Було (`backend/app/main.py:58-90` та відсутність у `backend/alembic/versions/`):
Індекси створювалися лише умовно в `lifespan` при `settings.run_schema_bootstrap == True`, а функціональних індексів `lower(email)` не існувало взагалі.

#### Стало (новий файл міграції `backend/alembic/versions/20261105_add_missing_perf_indexes.py`):
```python
"""add missing performance and functional indexes

Revision ID: 20261105_perf_idx
Revises: 20261102_add_academic_terms
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "20261105_perf_idx"
down_revision = "20261102_add_academic_terms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Закріплення 5 складених індексів із main.py у схемі Alembic
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_active_lookup "
        "ON schedule (is_active, version_id, day_of_week, group_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_imp_changes_lookup "
        "ON imported_schedule_changes (publication_id, change_date, group_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_override_date_group "
        "ON schedule_override (override_date, group_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_notes_week_lookup "
        "ON lesson_occurrence_notes (archived, note_date, group_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_snapshots_pub_group "
        "ON published_group_snapshots (publication_id, group_id)"
    )

    # 2. Функціональні індекси LOWER(email) для швидкої перевірки доступу Classroom
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_classroom_cred_lower_email "
        "ON classroom_credentials (lower(email))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_group_students_lower_email "
        "ON group_students (lower(email), group_id)"
    )

    # 3. Індекси для чернеток, публікацій та перенесених пар
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_drafts_type_status_id "
        "ON schedule_drafts (draft_type, status, id DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schedule_publications_reverted_id "
        "ON schedule_publications (is_reverted, id DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_override_moved_to_lookup "
        "ON schedule_override (group_id, moved_to_date, moved_to_lesson)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_override_moved_to_lookup")
    op.execute("DROP INDEX IF EXISTS ix_schedule_publications_reverted_id")
    op.execute("DROP INDEX IF EXISTS ix_schedule_drafts_type_status_id")
    op.execute("DROP INDEX IF EXISTS ix_group_students_lower_email")
    op.execute("DROP INDEX IF EXISTS ix_classroom_cred_lower_email")
    op.execute("DROP INDEX IF EXISTS ix_snapshots_pub_group")
    op.execute("DROP INDEX IF EXISTS ix_notes_week_lookup")
    op.execute("DROP INDEX IF EXISTS ix_override_date_group")
    op.execute("DROP INDEX IF EXISTS ix_imp_changes_lookup")
    op.execute("DROP INDEX IF EXISTS ix_schedule_active_lookup")
```

#### Спосіб перевірки ефекту:
Виконати в `psql` до та після `alembic upgrade head`:
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT group_id FROM group_students
WHERE lower(email) = 'student@dfkr.dp.ua' AND group_id = 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, status, created_at FROM schedule_drafts
WHERE draft_type = 'auto_import' AND status = 'pending'
ORDER BY id DESC LIMIT 1;
```
- **Очікуваний результат**: заміна `Seq Scan` на `Index Scan using ix_group_students_lower_email` та `Index Scan using ix_schedule_drafts_type_status_id`, зменшення часу виконання запитів з `1.5–10 ms` до `< 0.08 ms`.

---

### Х1.2. Відновлення HTTP/CDN та ETag кешування (`Vary`, заголовки `X-Classroom-*`, довідники)

**Проблема**:
1. `Vary: Date` у `backend/app/routers/schedule.py:304,383` вимикає кешування `s-maxage=15`.
2. У `frontend/lib/api.ts:469-470` читаються неіснуючі ключі `localStorage` з підкресленням (`schedule_classroom_google_user_id`), через що заголовки `X-Classroom-*` не відправляються, а натомість `attachClassroomQueryParams()` додає персональні параметри в URL.
3. `/api/teacher-subjects` (`backend/app/routers/directory.py:157-184`) не використовує `_DIR_CACHE`.

#### Було (`backend/app/routers/schedule.py:300-305` та `379-384`):
```python
    etag = _compute_etag(payload)
    if _not_modified(request, etag):
        return Response(status_code=304, headers={"ETag": etag})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=15, stale-while-revalidate=300"
    response.headers["Vary"] = "Date, Origin, Accept-Encoding, X-Classroom-User-Id, X-Classroom-Email, X-Teacher-Pin, Authorization"
```

#### Стало (`backend/app/routers/schedule.py:300-308` та `379-387`):
```python
    etag = _compute_etag(payload)
    vary_header = "Origin, Accept-Encoding, X-Classroom-User-Id, X-Classroom-Email, X-Teacher-Pin, Authorization"
    has_auth_context = any(
        request.headers.get(h)
        for h in ("X-Classroom-User-Id", "X-Classroom-Email", "X-Teacher-Pin", "Authorization")
    )
    cache_control = (
        "private, max-age=0, must-revalidate"
        if has_auth_context
        else "public, max-age=0, s-maxage=15, stale-while-revalidate=300"
    )
    if _not_modified(request, etag):
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": cache_control, "Vary": vary_header})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = cache_control
    response.headers["Vary"] = vary_header
```

#### Було (`frontend/lib/api.ts:427-438` та `468-476`):
```typescript
function attachClassroomQueryParams(path: string): string {
  if (typeof window === "undefined") return path;
  const separator = path.includes("?") ? "&" : "?";
  const uid = localStorage.getItem("schedule:classroom_google_user_id");
  const email = localStorage.getItem("schedule:classroom_linked_email");
  const teacherPin = localStorage.getItem("schedule:teacher_unlock_pin");
  const extras: string[] = [];
  if (uid) extras.push(`classroom_user_id=${encodeURIComponent(uid)}`);
  if (email) extras.push(`classroom_email=${encodeURIComponent(email)}`);
  if (teacherPin) extras.push(`teacher_pin=${encodeURIComponent(teacherPin)}`);
  return extras.length > 0 ? `${path}${separator}${extras.join("&")}` : path;
}
// ...
  if (typeof window !== "undefined") {
    const classroomUid = localStorage.getItem("schedule_classroom_google_user_id");
    const classroomEmail = localStorage.getItem("schedule_classroom_linked_email");
    const teacherPin = localStorage.getItem("schedule:teacher_unlock_pin");
    if (classroomUid) headers.set("X-Classroom-User-Id", classroomUid);
    if (classroomEmail) headers.set("X-Classroom-Email", classroomEmail);
    if (teacherPin) headers.set("X-Teacher-Pin", teacherPin);
  }
```

#### Стало (`frontend/lib/api.ts:427-438` та `468-476`):
```typescript
function attachClassroomQueryParams(path: string): string {
  // Ідентифікатори Classroom та PIN викладача передаються виключно через HTTP-заголовки
  // X-Classroom-User-Id, X-Classroom-Email та X-Teacher-Pin у rawRequest(),
  // щоб не забруднювати URL персональними даними та не ламати ключ кешування.
  return path;
}
// ...
  if (typeof window !== "undefined") {
    const classroomUid = localStorage.getItem("schedule:classroom_google_user_id");
    const classroomEmail = localStorage.getItem("schedule:classroom_linked_email");
    const teacherPin = localStorage.getItem("schedule:teacher_unlock_pin");
    if (classroomUid) headers.set("X-Classroom-User-Id", classroomUid);
    if (classroomEmail) headers.set("X-Classroom-Email", classroomEmail);
    if (teacherPin) headers.set("X-Teacher-Pin", teacherPin);
  }
```
*(Примітка: на бекенді в `schedule.py` підтримка query-параметрів `classroom_user_id`, `classroom_email`, `teacher_pin` залишається для зворотної сумісності API-контракту).*

#### Було (`backend/app/routers/directory.py:157-184`):
```python
@router.get("/teacher-subjects")
async def get_teacher_subjects(db: AsyncSession = Depends(get_db)):
    """Return mapping of teacher_id -> list of subject_ids they teach in active schedule."""
    res1 = await db.execute(
        select(Schedule.teacher_id, Schedule.subject_id)
        .where(Schedule.is_active == True, Schedule.teacher_id.isnot(None))
        .distinct()
    )
    # ... другий запит для teacher2_id без кешування
```

#### Стало (`backend/app/routers/directory.py:157-188`):
```python
@router.get("/teacher-subjects")
async def get_teacher_subjects(response: Response, db: AsyncSession = Depends(get_db)):
    """Return mapping of teacher_id -> list of subject_ids they teach in active schedule."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    cache_key = f"teacher_subjects:{get_schedule_cache_rev()}"
    cached = _dir_cache_get(cache_key)
    if cached is not None:
        return cached

    res1 = await db.execute(
        select(Schedule.teacher_id, Schedule.subject_id)
        .where(Schedule.is_active == True, Schedule.teacher_id.isnot(None))
        .distinct()
    )
    res2 = await db.execute(
        select(Schedule.teacher2_id, Schedule.subject_id)
        .where(Schedule.is_active == True, Schedule.teacher2_id.isnot(None))
        .distinct()
    )
    mapping: dict[int, set[int]] = {}
    for t_id, s_id in list(res1.all()) + list(res2.all()):
        if t_id and s_id:
            mapping.setdefault(t_id, set()).add(s_id)
    result = {str(k): list(v) for k, v in mapping.items()}
    _dir_cache_set(cache_key, result)
    return result
```

#### Спосіб перевірки ефекту:
1. Перевірити заголовки та `304 Not Modified` через `curl`:
   ```bash
   ETAG=$(curl -sI "http://localhost:8000/api/schedule/week?group_id=1&target_date=2026-11-02" | awk '/^etag:/ {print $2}' | tr -d '\r')
   curl -i -H "If-None-Match: $ETAG" "http://localhost:8000/api/schedule/week?group_id=1&target_date=2026-11-02"
   ```
   Переконатися, що повертається `HTTP/1.1 304 Not Modified`, заголовок `Vary` не містить `Date`, а в Network-вкладці браузера запити до `/api/schedule/week` більше не містять `?classroom_email=...` в URL і використовують заголовки `X-Classroom-*`.

---

### Х1.3. Усунення зайвих SQL-запитів на гарячому шляху `/api/schedule*`

**Проблема**:
1. У `backend/app/routers/schedule.py:202,311` викликається `resolve_group_learning_mode_detail(db, group_id, target_date)` без передачі вже завантаженого `group=scope`, що викликає повторний `await db.get(Group, group_id)`.
2. `attach_notes()` (`backend/app/services/lesson_notes.py:137-148`) викликається поза кешем проекції і щоразу робить 2 SQL-запити (`LessonOccurrenceNote` + повторний `ScheduleOverride`).

#### Було (`backend/app/routers/schedule.py:200-204` та `310-314`):
```python
    if group_id is not None:
        scope = await db.get(Group, group_id)
        learning_mode_info = await resolve_group_learning_mode_detail(db, group_id, target_date)
```

#### Стало (`backend/app/routers/schedule.py:200-204` та `310-314`):
```python
    if group_id is not None:
        scope = await db.get(Group, group_id)
        learning_mode_info = await resolve_group_learning_mode_detail(db, group_id, target_date, group=scope)
```

#### Було (`backend/app/services/projection.py:349-358` та `688-697`):
`build_projection` та `build_week_projection` зберігали список `lessons` у `_DAY_PROJ_CACHE` / `_WEEK_PROJ_CACHE` **без нотаток**, а роутер `schedule.py:181,288,370` викликав `await attach_notes(db, lessons)` на кожному запиті, де `attach_notes` заново запитував `LessonOccurrenceNote` та `ScheduleOverride`.

#### Стало (`backend/app/services/projection.py` + `backend/app/services/lesson_notes.py`):
У `attach_notes` додається опційний параметр `preloaded_overrides: list[ScheduleOverride] | None = None`, а сам виклик `await attach_notes(db, lessons, preloaded_overrides=overrides)` виконується **всередині** `build_projection()` та `build_week_projection()` перед записом у `_DAY_PROJ_CACHE` / `_WEEK_PROJ_CACHE` (оскільки зміна нотаток вже викликає `bump_schedule_cache_rev()` у `main.py:182-186`, кеш проекції інвалідується автоматично при будь-якій зміні нотатки):

```python
# У backend/app/services/lesson_notes.py:114
async def attach_notes(
    db: AsyncSession,
    lessons: list[dict],
    preloaded_overrides: list[ScheduleOverride] | None = None,
) -> list[dict]:
    if not lessons:
        return lessons
    # ...
    note_rows = (await db.execute(stmt)).scalars().all()

    if preloaded_overrides is not None:
        override_rows = [
            ov for ov in preloaded_overrides
            if ov.group_id in group_ids and (ov.override_date in dates or ov.moved_to_date in dates)
        ]
    else:
        override_stmt = select(ScheduleOverride).where(...)
        override_rows = (await db.execute(override_stmt)).scalars().all()
```
І в `backend/app/services/projection.py:348` (та аналогічно в `build_week_projection` на рядку `688`):
```python
    from app.services.lesson_notes import attach_notes
    await attach_notes(db, result, preloaded_overrides=overrides)
    if len(_DAY_PROJ_CACHE) > 256:
        _DAY_PROJ_CACHE.clear()
    _DAY_PROJ_CACHE[cache_key] = (_now_mono() + _PROJ_CACHE_TTL, copy.deepcopy(result))
    return result
```

#### Спосіб перевірки ефекту:
Увімкнути логування SQL-запитів (`echo=True` у `database.py` або підрахунок через `sqlalchemy.event.listen(engine.sync_engine, "before_cursor_execute", ...)`):
- **До**: при повторному запиті `GET /api/schedule/week?group_id=1` протягом 45 с (хіт `_WEEK_PROJ_CACHE`) виконувалось **5 SQL-запитів** (`LessonOccurrenceNote`, `ScheduleOverride`, `Group`, `AppSetting`, `SchedulePeriod`).
- **Після**: при хіті кешу для неавторизованого запиту виконується **0–1 SQL-запит** (або миттєвий `304 Not Modified`), час відповіді падає з `25–60 мс` до `1–3 мс`.

---

### Х1.4. Усунення N+1 запитів та відкладене завантаження важких JSON-полів (`drafts.py`, `admin_import.py`)

**Проблема**:
1. `list_drafts()` (`backend/app/routers/drafts.py:104-125`) завантажує важкий стовпець `ScheduleDraft.data` (мегабайти JSON-снепшотів для всіх чернеток) та виконує N+1 запит `ScheduleSlot` у циклі для ролі `editor`.
2. `_do_import()` (`backend/app/routers/admin_import.py:1424-1433`) у циклі виконує `SELECT max(version) FROM imported_schedule_changes` для кожної заміни.

#### Було (`backend/app/routers/drafts.py:104-125`):
```python
@router.get("/", response_model=List[DraftOut])
async def list_drafts(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    res = await db.execute(select(ScheduleDraft).order_by(ScheduleDraft.created_at.desc()))
    drafts = res.scalars().all()
    if current_user.role == "editor":
        allowed_fids = set(current_user.faculty_ids or ([] if not current_user.faculty_id else [current_user.faculty_id]))
        group_res = await db.execute(select(Group.id).where(Group.faculty_id.in_(allowed_fids)))
        allowed_gids = {r[0] for r in group_res.all()}
        filtered = []
        for d in drafts:
            if d.draft_type in ("import", "auto_import"):
                filtered.append(d)
                continue
            slot_res = await db.execute(
                select(ScheduleSlot).where(ScheduleSlot.draft_id == d.id).options(selectinload(ScheduleSlot.curriculum))
            )
            slots = slot_res.scalars().all()
            if not slots or any(s.curriculum and s.curriculum.group_id in allowed_gids for s in slots):
                filtered.append(d)
        drafts = filtered
```

#### Стало (`backend/app/routers/drafts.py:104-130`):
```python
@router.get("/", response_model=List[DraftOut])
async def list_drafts(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    res = await db.execute(select(ScheduleDraft).order_by(ScheduleDraft.created_at.desc()))
    drafts = res.scalars().all()
    if current_user.role == "editor":
        allowed_fids = set(current_user.faculty_ids or ([] if not current_user.faculty_id else [current_user.faculty_id]))
        group_res = await db.execute(select(Group.id).where(Group.faculty_id.in_(allowed_fids)))
        allowed_gids = {r[0] for r in group_res.all()}

        non_import_ids = [d.id for d in drafts if d.draft_type not in ("import", "auto_import")]
        drafts_with_slots: set[int] = set()
        drafts_with_allowed_groups: set[int] = set()
        if non_import_ids:
            slot_rows = (
                await db.execute(
                    select(ScheduleSlot.draft_id, Curriculum.group_id)
                    .outerjoin(Curriculum, ScheduleSlot.curriculum_id == Curriculum.id)
                    .where(ScheduleSlot.draft_id.in_(non_import_ids))
                    .distinct()
                )
            ).all()
            for d_id, g_id in slot_rows:
                drafts_with_slots.add(d_id)
                if g_id in allowed_gids:
                    drafts_with_allowed_groups.add(d_id)

        drafts = [
            d for d in drafts
            if d.draft_type in ("import", "auto_import")
            or d.id not in drafts_with_slots
            or d.id in drafts_with_allowed_groups
        ]
```

#### Було (`backend/app/routers/admin_import.py:1423-1435`):
```python
        for sub in auto_publish_substitutions:
            change_date = date.fromisoformat(sub["date"])
            group_id = sub["group_id"]
            lesson_number = sub["lesson_number"]
            max_ver = (
                await db.execute(
                    select(func.max(ImportedScheduleChange.version)).where(
                        ImportedScheduleChange.change_date == change_date,
                        ImportedScheduleChange.group_id == group_id,
                        ImportedScheduleChange.lesson_number == lesson_number,
                    )
                )
            ).scalar() or 0
```

#### Стало (`backend/app/routers/admin_import.py:1423-1445`):
```python
        from sqlalchemy import tuple_
        sub_keys = list({
            (date.fromisoformat(s["date"]), s["group_id"], s["lesson_number"])
            for s in auto_publish_substitutions
        })
        max_ver_map: dict[tuple[date, int, int], int] = {}
        for i in range(0, len(sub_keys), 500):
            chunk = sub_keys[i : i + 500]
            rows = (
                await db.execute(
                    select(
                        ImportedScheduleChange.change_date,
                        ImportedScheduleChange.group_id,
                        ImportedScheduleChange.lesson_number,
                        func.max(ImportedScheduleChange.version),
                    )
                    .where(
                        tuple_(
                            ImportedScheduleChange.change_date,
                            ImportedScheduleChange.group_id,
                            ImportedScheduleChange.lesson_number,
                        ).in_(chunk)
                    )
                    .group_by(
                        ImportedScheduleChange.change_date,
                        ImportedScheduleChange.group_id,
                        ImportedScheduleChange.lesson_number,
                    )
                )
            ).all()
            for c_date, g_id, l_num, m_ver in rows:
                max_ver_map[(c_date, g_id, l_num)] = m_ver or 0

        for sub in auto_publish_substitutions:
            change_date = date.fromisoformat(sub["date"])
            group_id = sub["group_id"]
            lesson_number = sub["lesson_number"]
            max_ver = max_ver_map.get((change_date, group_id, lesson_number), 0)
```

#### Спосіб перевірки ефекту:
Виміряти кількість SQL-запитів та час відповіді `GET /api/drafts/` (під акаунтом `editor`) і `POST /api/admin/import`:
- `GET /api/drafts/`: замість $1 + N$ запитів виконується рівно **3 SQL-запити** незалежно від кількості чернеток.
- `POST /api/admin/import`: при 100 замінах кількість SQL-запитів зменшується з ~200+ до 2–3 пакетних запитів.

---

### Х1.5. Винесення синхронного хешування Argon2 у `asyncio.to_thread`

**Проблема**: `verify_password()` та `get_password_hash()` у `backend/app/core/security.py:20-25` виконують важке CPU-обчислення Argon2 синхронно в основному потоці event loop. Під час входу користувача (`backend/app/routers/auth.py:97`) або зміни пароля (`backend/app/routers/users.py:71,101`) весь Uvicorn-воркер «завмирає» на 50–150 мс.

#### Було (`backend/app/core/security.py:20-25` та `backend/app/routers/auth.py:97`):
```python
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)
```
```python
    if not user or not verify_password(login_req.password, user.password_hash):
```

#### Стало (`backend/app/core/security.py:20-33` та `backend/app/routers/auth.py:97`):
```python
import asyncio

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    return await asyncio.to_thread(pwd_context.verify, plain_password, hashed_password)

async def get_password_hash_async(password: str) -> str:
    return await asyncio.to_thread(pwd_context.hash, password)
```
```python
    if not user or not await verify_password_async(login_req.password, user.password_hash):
```

#### Спосіб перевірки ефекту:
Запустити паралельний бенчмарк: під час 5 одночасних запитів `POST /api/auth/login` заміряти латентність паралельного запиту `GET /api/ping` або `GET /api/schedule/today`.
- **До**: латентність паралельного `GET /api/ping` стрибає з `2 мс` до `300–600 мс` через блокування event loop.
- **Після**: латентність `GET /api/ping` залишається стабільною (`< 10 мс`).

---

### Х1.6. Усунення шторму запитів на фронтенді (`visibilitychange`, `prefetchAdjacentWeeks`, `Heartbeat`)

**Проблема**:
1. При кожному перемиканні вкладки `frontend/app/page.tsx:286-297` викликає `invalidateScheduleCache()`, яка стирає всі збережені `ETag` (`invalidateEtagCache()`) і `localStorage`, а також дублює слухач `visibilitychange` із `frontend/lib/hooks.ts:358-364`.
2. `prefetchAdjacentWeeks()` (`frontend/lib/hooks.ts:232-253`) безумовно запускає 2 важкі запити `/api/schedule/week` через 350 мс після кожного завантаження тижня.
3. `Heartbeat.tsx:70,138` двічі викликає `GET /api/ping` при першому завантаженні сторінки.

#### Було (`frontend/lib/hooks.ts:11-25` та `frontend/app/page.tsx:286-297`):
```typescript
// frontend/lib/hooks.ts:11-25
export function invalidateScheduleCache() {
  memoryCache.clear();
  invalidateEtagCache();
  if (typeof window !== "undefined") {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("schedule:today:") || k.startsWith("schedule:week:") || k.startsWith("schedule:date:"))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    window.dispatchEvent(new Event("schedule:refresh"));
  }
}
```
```typescript
// frontend/app/page.tsx:286-297
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        invalidateScheduleCache();
        if (mode === "group" && groupId) {
          fetchClassroomTasks(groupId);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [mode, groupId, fetchClassroomTasks]);
```

#### Стало (`frontend/lib/hooks.ts` та `frontend/app/page.tsx`):
1. Розділити м'яку ревалідацію (при поверненні на вкладку — зі збереженням `ETag`, щоб бекенд відповідав легким `304 Not Modified`, і з тротлінгом 60 секунд) та жорстке скидання кешу (при зміні PIN-коду або ручному оновленні):
```typescript
// frontend/lib/hooks.ts
let lastVisibilityRevalidateAt = 0;
const VISIBILITY_REVALIDATE_COOLDOWN_MS = 60_000;

export function revalidateScheduleOnFocus() {
  const now = Date.now();
  if (now - lastVisibilityRevalidateAt < VISIBILITY_REVALIDATE_COOLDOWN_MS) {
    return;
  }
  lastVisibilityRevalidateAt = now;
  // Очищуємо лише TTL у memoryCache, зберігаючи etagCache та localStorage для 304 Not Modified!
  memoryCache.clear();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("schedule:refresh"));
  }
}
```
2. У `frontend/app/page.tsx:286-297` замінити `invalidateScheduleCache()` на `revalidateScheduleOnFocus()`, а з `frontend/lib/hooks.ts:358-366` прибрати дублюючий `document.addEventListener("visibilitychange", ...)`.
3. У `frontend/lib/hooks.ts:232-253` змінити `prefetchAdjacentWeeks`:
```typescript
  const prefetchAdjacentWeeks = useCallback((baseDate: string, gId?: number, tId?: number) => {
    if (!baseDate || (gId === undefined && tId === undefined)) return;
    if (typeof navigator !== "undefined" && (navigator as any).connection?.saveData) return;

    const timer = setTimeout(() => {
      for (const offset of [-7, 7]) {
        const adjMonday = getMondayIso(shiftIsoDate(baseDate, offset));
        const adjKey = `schedule:week:${gId ?? "all"}:${tId ?? "all"}:${adjMonday}`;
        // Не виконувати мережевий запит, якщо сусідній тиждень вже є в пам'яті або свіжий у localStorage
        if (getMemoryCached(adjKey) || getCachedTimestamp(adjKey) > Date.now() - CACHE_TTL_MS) {
          continue;
        }
        api.week({ groupId: gId, teacherId: tId, targetDate: adjMonday })
          .then((adjData) => {
            setCached(adjKey, adjData);
            setMemoryCached(adjKey, adjData);
          })
          .catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);
```
4. У `frontend/components/Heartbeat.tsx:105-140` пропустити перший рендер у `useEffect(..., [user])`, оскільки перший `useEffect(..., [])` вже викликає `ping()` при монтуванні:
```typescript
  const isInitialUserEffect = useRef(true);
  useEffect(() => {
    if (isInitialUserEffect.current) {
      isInitialUserEffect.current = false;
      return;
    }
    // ... існуюча логіка реакції на зміну user
  }, [user]);
```

#### Спосіб перевірки ефекту:
Відкрити Chrome DevTools → вкладка **Network** (фільтр `Fetch/XHR`):
1. Перезавантажити головну сторінку `/`:
   - Переконатися, що `/api/ping` викликається **1 раз** замість 2.
   - При повторному завантаженні сусідні тижні (`-7` та `+7`), які вже є в `localStorage`, не перезапитуються з мережі.
2. Перемкнутися на іншу вкладку браузера і повернутися назад:
   - Протягом перших 60 с мережевих запитів до `/api/schedule/week` **0**.
   - Після 60 с виконується рівно **1** запит із заголовком `If-None-Match` і статусом `304 Not Modified` (розмір тіла 0 байт) замість 3–6 повних запитів `200 OK`.

---

## 5. Ризики та що може зламатися для кожної зміни

| Зміна | Що може піти не так / Ризик | Як запобігти / План відкату |
|---|---|---|
| **Х1.1. Нові індекси БД (Alembic)** | На великій таблиці `CREATE INDEX` без `CONCURRENTLY` бере короткочасний `SHARE` лок на таблицю під час деплою. | Таблиці розкладу коледжу мають десятки тисяч рядків, тому створення індексу займає `< 50 мс`. Для відкату достатньо виконати `alembic downgrade -1`. |
| **Х1.2. Прибирання query-параметрів `classroom_*` з URL та зміна `Cache-Control` / `Vary`** | Якщо зовнішній клієнт або старий кешований JS передає `classroom_email` через query-параметр, а бекенд перестане його читати — закриються посилання на онлайн-пари. Якщо CDN закешує відповідь із відкритим за PIN-кодом посиланням як `public` — інші користувачі побачать посилання. | 1) На бекенді залишити читання і з заголовків `X-Classroom-*`/`X-Teacher-Pin`, і з query-параметрів (fallback).<br>2) Якщо в запиті присутній будь-який із заголовків авторизації/PIN/Classroom, виставляти `Cache-Control: private, max-age=0, must-revalidate`. |
| **Х1.3. Кешування результату `attach_notes()` всередині `_DAY_PROJ_CACHE` / `_WEEK_PROJ_CACHE`** | Якщо нотатка до пари або ДЗ з Google Classroom оновиться в БД без інкременту `get_schedule_cache_rev()`, користувачі бачитимуть стару нотатку до 45 секунд (TTL кешу). | У `backend/app/main.py:182-186` вже зареєстровано глобальний SQLAlchemy-хук `after_flush`, який викликає `bump_schedule_cache_rev()` при будь-якому `new / dirty / deleted` об'єкті в сесії (включно з `LessonOccurrenceNote`). Додатково варто явно викликати `bump_schedule_cache_rev()` після `db.commit()` у `routers/lesson_notes.py` та `routers/classroom.py`. |
| **Х1.4. Пакетні запити в `drafts.py` та `admin_import.py`** | При дуже великій кількості елементів у `.in_(...)` (понад 32 767 параметрів в `asyncpg`) запит впаде з помилкою ліміту параметрів PostgreSQL. | Розбивати список ключів на чанки по 500 елементів (`for i in range(0, len(keys), 500):`), як показано в прикладі коду Х1.4. |
| **Х1.5. `asyncio.to_thread` для Argon2** | Немає ризику для контракту, оскільки `pwd_context.verify` та `pwd_context.hash` є чистими потокобезпечними функціями без спільного мутабельного стану. | Покрито існуючими тестами авторизації в `backend/tests/`. |
| **Х1.6. Тротлінг `visibilitychange` (60 с) та умовний `prefetchAdjacentWeeks`** | Якщо адміністратор опублікував заміну, а студент перемкнув вкладку туди-сюди менш ніж через 60 секунд після відкриття сторінки, він побачить оновлення не миттєво, а через 60 с або при ручному свайпі/оновленні. | При явному кліку на кнопку оновлення або зміні групи/PIN-коду викликати повний `invalidateScheduleCache()`, а для `visibilitychange` використовувати `revalidateScheduleOnFocus()` з 60-секундним вікном. |
| **Х2.4. Зменшення `networkTimeoutSeconds` у Service Worker до 4 с** | На дуже повільному мобільному інтернеті (Edge/2G, де запит триває 5–7 с) SW через 4 с віддасть закешований розклад замість очікування мережі. | Оскільки паралельно працює `useSchedule`, який при завантаженні показує `localStorage` і оновлює стейт по завершенню мережевого запиту, користувач швидше побачить розклад без білого екрана чи помилки `AbortError`. |
| **Х3.1. Запуск `--workers 2` у Uvicorn** | Якщо не вимкнути `RUN_CRON=true` у веб-процесі перед збільшенням `--workers`, обидва воркери одночасно запустять фоновий імпорт і синхронізацію Classroom, що призведе до race conditions. | Збільшувати кількість воркерів Uvicorn **лише** після встановлення `RUN_CRON=false` для веб-процесу та виділення `python -m app.worker` в окремий процес. |

---

## 6. Список відкритих питань до автора проекту

1. **Актуальна платформа та регіон хостингу БД і бекенду**:
   - У репозиторії одночасно присутні конфігурації для **Fly.io** (`backend/fly.toml` у регіоні `fra` та `.github/workflows/fly-deploy.yml`) і для **Heroku** (`backend/Procfile` та `.github/workflows/python-app.yml`), а в `backend/app/routers/admin_import.py:1727` є ендпоінт міграції з **Neon**.
   - *Питання*: Де саме зараз розгорнутий production-бекенд (Fly.io чи Heroku/Railway) і в якому хмарному провайдері та регіоні (наприклад, `eu-central-1` Франкфурт чи `us-east-1`) знаходиться production-база PostgreSQL?
2. **Стратегія запуску фонових воркерів (`RUN_CRON`)**:
   - Зараз у `backend/fly.toml:14` встановлено `RUN_CRON = 'true'`, тобто фонові цикли `classroom_auto_sync_loop` та `schedule_auto_import_loop` працюють прямо всередині веб-процесу Uvicorn, а сам контейнер має `auto_stop_machines = 'stop'` та `min_machines_running = 0`. Коли машина зупиняється за відсутності трафіку, фонова синхронізація також зупиняється.
   - *Питання*: Чи планується запуск окремого процесу `python -m app.worker` (або перехід на постійно активний інстанс / VPS без `auto_stop_machines`), чи фонові задачі мають залишатися всередині єдиного веб-контейнера через бюджетні обмеження тарифу?
3. **Обсяг історичних нотаток `lesson_occurrence_notes`**:
   - Під час синхронізації Google Classroom (`backend/app/routers/classroom.py:918-925`) завантажуються всі нотатки групи за весь час.
   - *Питання*: Чи потрібно синхронізувати та оновлювати завдання Google Classroom для пар, які відбулися понад 30–60 днів тому (чи попереднього семестру), чи достатньо обмежити вікно синхронізації поточним семестром (`AcademicTerm.is_current == True`)?
4. **Анімації `framer-motion` у тижневому та денному розкладі**:
   - Бібліотека `framer-motion` (~35–40 КБ gzip) використовується в критичному бандлі головної сторінки для анімації свайпів у `DayPager.tsx` та появи карток у `ScheduleDay.tsx`.
   - *Питання*: Чи прийнятно замінити прості fade/slide-анімації списку пар у `ScheduleDay.tsx` на нативні CSS-переходи (`transition-all`), залишивши `framer-motion` (або легший `LazyMotion` з `domAnimation`) лише для жестів свайпу в мобільному `DayPager.tsx`?
