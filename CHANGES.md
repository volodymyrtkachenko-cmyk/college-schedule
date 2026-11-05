# CHANGES.md: Звіт про застосовані безпечні оптимізації швидкодії

Дата: 2026-11-05  
Проект: `college-schedule`  
Гілка: `main`

---

## 1. Резюме внесених змін

Усі 6 кроків оптимізації успішно реалізовано окремими незалежними комітами з повним збереженням існуючих API-контрактів та зворотної сумісності:
1. `3aa700b` — `fix(frontend): read classroom credentials with colon prefix from localStorage in rawRequest`
2. `1ad1c38` — `fix(backend): remove Date from Vary and use private Cache-Control for authenticated/PIN requests in /api/schedule`
3. `b38360b` — `feat(backend): add Alembic migration for classroom, drafts, publications and overrides indexes`
4. `8b06836` — `fix(frontend): throttle visibilitychange revalidation, optimize prefetchAdjacentWeeks and deduplicate heartbeat ping`
5. `4764b13` — `perf(backend): offload Argon2 password hashing and verification to thread pool with asyncio.to_thread`
6. `b948c7b` — `perf(backend): add Cache-Control and _DIR_CACHE caching to /api/teacher-subjects`

---

## 2. Детальний опис кожної зміни

### Зміна 1: Виправлення ключів `localStorage` для Classroom-заголовків
- **Файл**: `frontend/lib/api.ts` (рядки 466–478)
- **Коміт**: `3aa700b`
- **Що було**:
  ```typescript
  const classroomUid = localStorage.getItem("schedule_classroom_google_user_id");
  if (classroomUid && !headers.has("X-Classroom-User-Id")) {
      headers.set("X-Classroom-User-Id", classroomUid);
  }
  const classroomEmail = localStorage.getItem("schedule_classroom_linked_email");
  if (classroomEmail && !headers.has("X-Classroom-Email")) {
      headers.set("X-Classroom-Email", classroomEmail);
  }
  ```
  Через використання ключів з підкресленням замість двокрапки (`schedule_classroom_...` замість `schedule:classroom_...`) `classroomUid` та `classroomEmail` завжди повертали `null`. Внаслідок цього HTTP-заголовки `X-Classroom-User-Id` та `X-Classroom-Email` ніколи не відправлялися на сервер, а для ідентифікації використовувалися виключно query-параметри в URL.
- **Що стало**:
  ```typescript
  const classroomUid = localStorage.getItem("schedule:classroom_google_user_id") || localStorage.getItem("schedule_classroom_google_user_id");
  if (classroomUid && !headers.has("X-Classroom-User-Id")) {
      headers.set("X-Classroom-User-Id", classroomUid);
  }
  const classroomEmail = localStorage.getItem("schedule:classroom_linked_email") || localStorage.getItem("schedule_classroom_linked_email");
  if (classroomEmail && !headers.has("X-Classroom-Email")) {
      headers.set("X-Classroom-Email", classroomEmail);
  }
  ```
  Читаються актуальні ключі з двокрапкою з фолбеком на старий формат. Заголовки `X-Classroom-User-Id` та `X-Classroom-Email` тепер реально відправляються у кожному запиті клієнта.
- **Зворотна сумісність**: Query-параметри `classroom_user_id`, `classroom_email` та `teacher_pin` залишено на бекенді в `schedule.py` як fallback.
- **Як відкотити**:
  ```bash
  git revert 3aa700b
  ```

---

### Зміна 2: Заголовок `Vary` та динамічний `Cache-Control` у `/api/schedule`
- **Файл**: `backend/app/routers/schedule.py` (рядки 301–320 та 394–415)
- **Коміт**: `1ad1c38`
- **Що було**:
  ```python
  response.headers["Cache-Control"] = "public, max-age=0, s-maxage=15, stale-while-revalidate=300"
  response.headers["Vary"] = "Date, Origin, Accept-Encoding, X-Classroom-User-Id, X-Classroom-Email, X-Teacher-Pin, Authorization"
  ```
  Присутність `Date` у `Vary` руйнувала кешування на проксі та CDN (`s-maxage=15`), тому що заголовок `Date` змінюється щосекунди. Також відповіді з персональним доступом до закритих посилань кешувалися як `public`.
- **Що стало**:
  ```python
  has_auth_context = False
  if request:
      has_auth_context = bool(
          request.headers.get("authorization")
          or request.headers.get("x-teacher-pin")
          or request.headers.get("x-classroom-user-id")
          or request.headers.get("x-classroom-email")
          or request.query_params.get("teacher_pin")
          or request.query_params.get("classroom_user_id")
          or request.query_params.get("classroom_email")
      )
  if has_auth_context:
      response.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
  else:
      response.headers["Cache-Control"] = "public, max-age=0, s-maxage=15, stale-while-revalidate=300"
  response.headers["Vary"] = "Origin, Accept-Encoding, X-Classroom-User-Id, X-Classroom-Email, X-Teacher-Pin, Authorization"
  ```
  1. `Date` прибрано з `Vary`.
  2. Запити з контекстом авторизації/PIN/Classroom отримують `private, max-age=0, must-revalidate` (захист від витоку персональних посилань на CDN).
  3. Гостьові запити зберігають `public` та `s-maxage=15` і тепер коректно кешуються на CDN/проксі.
- **Як відкотити**:
  ```bash
  git revert 1ad1c38
  ```

---

### Зміна 3: Індекси бази даних (нова міграція Alembic)
- **Файл**: `backend/alembic/versions/20261105_perf_indexes.py`
- **Коміт**: `b38360b`
- **Що додано**:
  1. `ix_classroom_cred_lower_email` ON `classroom_credentials (lower(email))`
  2. `ix_group_students_lower_email` ON `group_students (lower(email))`
  3. `ix_schedule_drafts_type_status` ON `schedule_drafts (draft_type, status)`
  4. `ix_schedule_publications_reverted_id` ON `schedule_publications (is_reverted, id)`
  5. `ix_override_group_moved` ON `schedule_override (group_id, moved_to_date, moved_to_lesson)`
- **Що було в планах виконання**:
  - `group_students`: `SCAN group_students` (Full table scan).
  - `schedule_drafts`: `SCAN schedule_drafts` (Full table scan).
- **Що стало в планах виконання**:
  - `group_students`: `SEARCH group_students USING INDEX ix_group_students_lower_email (<expr>=?)`
  - `schedule_drafts`: `SEARCH schedule_drafts USING INDEX ix_schedule_drafts_type_status (draft_type=? AND status=?)`
- **Як відкотити**:
  ```bash
  (cd backend && alembic downgrade 20261102_academic_terms)
  git revert b38360b
  ```

---

### Зміна 4: Усунення шторму запитів на фронтенді
- **Файли**:
  - `frontend/lib/hooks.ts`
  - `frontend/app/page.tsx`
  - `frontend/components/Heartbeat.tsx`
- **Коміт**: `8b06836`
- **Що було**:
  - При кожному поверненні на вкладку `page.tsx` викликав `invalidateScheduleCache()`, яка стирала `etagCache` та весь `localStorage`, спричиняючи подвійний запит розкладу без ETag (`200 OK` замість `304 Not Modified`).
  - `hooks.ts` та `page.tsx` одночасно слухали подію `visibilitychange`.
  - `prefetchAdjacentWeeks` кожні 350 мс безумовно тягнув `-7` та `+7` тижні з сервера (26 SQL-запитів на cold load).
  - `Heartbeat.tsx` робив подвійний `/api/ping` на старті через одночасне спрацювання `useEffect([], ...)` та `useEffect([user], ...)`.
- **Що стало**:
  - При `visibilitychange` очищується **лише `memoryCache`**, тоді як `etagCache` та `localStorage` зберігаються для миттєвої віддачі та валідації через `304 Not Modified`.
  - Додано 60-секундний тротлінг для ревалідації при перемиканні вкладок.
  - З `page.tsx` прибрано дублюючий виклик `invalidateScheduleCache()`, а фонова перевірка Classroom tasks також обмежена інтервалом у 60 с.
  - `prefetchAdjacentWeeks`: перевіряє `(navigator as any).connection?.saveData`, перевіряє наявність тижня в `localStorage` (пропускає запит, якщо тиждень уже закешований) і виконується із затримкою 1500 мс замість 350 мс.
  - `Heartbeat.tsx`: додано `isFirstUserRenderRef`, що запобігає дублюючому пінгу при початковому рендері.
- **Як відкотити**:
  ```bash
  git revert 8b06836
  ```

---

### Зміна 5: Винесення Argon2 у пул потоків (`asyncio.to_thread`)
- **Файли**:
  - `backend/app/core/security.py`
  - `backend/app/routers/auth.py`
  - `backend/app/routers/users.py`
- **Коміт**: `4764b13`
- **Що було**:
  Синхронне обчислення хешу та перевірка пароля Argon2 (`password_hash.verify` / `password_hash.hash`) тривали 50–150 мс прямо в основному циклі подій `asyncio`, блокуючи обробку HTTP-запитів решти користувачів на час логіну.
- **Що стало**:
  Додано асинхронні обгортки:
  ```python
  async def verify_password_async(password: str, hashed_password: str) -> bool:
      return await asyncio.to_thread(password_hash.verify, password, hashed_password)

  async def hash_password_async(password: str) -> str:
      return await asyncio.to_thread(password_hash.hash, password)

  async def get_password_hash_async(password: str) -> str:
      return await asyncio.to_thread(password_hash.hash, password)
  ```
  Виклики в `routers/auth.py` (`login`) та `routers/users.py` (`create_user`, `update_user`) замінено на `await verify_password_async(...)` та `await hash_password_async(...)`. Цикл подій Uvicorn більше не блокується.
- **Як відкотити**:
  ```bash
  git revert 4764b13
  ```

---

### Зміна 6: Кешування довідника викладач-предмети
- **Файли**:
  - `backend/app/services/cache_rev.py`
  - `backend/app/routers/directory.py`
- **Коміт**: `b948c7b`
- **Що було**:
  Ендпоінт `GET /api/teacher-subjects` не віддавав заголовок `Cache-Control` і не використовував in-memory кеш, щоразу виконуючи 2 важкі `SELECT DISTINCT` по таблиці `schedule`.
- **Що стало**:
  - Додано `get_schedule_cache_rev()` у `app/services/cache_rev.py`.
  - Додано заголовок `response.headers["Cache-Control"] = "public, max-age=60"`.
  - Результат кешується в `_DIR_CACHE` з ключем `("teacher-subjects", get_schedule_cache_rev())`. Будь-яка зміна розкладу автоматично інвалідує кеш.
- **Як відкотити**:
  ```bash
  git revert b948c7b
  ```

---

## 3. Результати замірів (До / Після)

| Показник | До оптимізацій | Після оптимізацій | Різниця / Ефект |
|---|---|---|---|
| **Час `GET /api/schedule/week` (медіана)** | 3.64 мс | **3.46 мс** | -5% (на теплій in-memory проекції) |
| **Холодний старт проекції розкладу** | 45.44 мс | **40.42 мс** | -11% |
| **План запиту до `group_students`** | `SCAN group_students` (Full Scan) | `SEARCH USING INDEX ix_group_students_lower_email` | Миттєвий пошук за індексом замість O(N) |
| **План запиту до `schedule_drafts`** | `SCAN schedule_drafts` (Full Scan) | `SEARCH USING INDEX ix_schedule_drafts_type_status` | Миттєвий пошук за індексом замість O(N) |
| **Запити `/api/ping` на старті** | 2 запити | **1 запит** | -50% навантаження від початкового Heartbeat |
| **Мережеві запити `prefetchAdjacentWeeks`** | 2 безумовні запити через 350 мс | **0 запитів**, якщо тижні є в `localStorage` | Економія 26 SQL-запитів на старті |
| **Повернення на вкладку (`visibilitychange`)** | Повний рефетч зі знищенням кешу (`200 OK`) | **0 запитів** у перші 60 с; легкий `304 Not Modified` після 60 с | Усунено клієнтський шторм запитів |
| **Заголовок `Vary` розкладу** | Містив `Date` (ламав CDN-кеш) | `Date` видалено | Працює `s-maxage=15` на CDN/проксі |
| **Argon2 навантаження на event loop** | Блокування воркера на 50–150 мс | **0 мс блокування** (виконання в окремому потоці) | Стабільний час відповіді паралельних запитів |
| **Кешування `/api/teacher-subjects`** | Відсутнє, 2 SQL-запити на кожен виклик | In-memory кеш + `public, max-age=60` | 0 SQL-запитів при повторних викликах |

---

## 4. Результати автоматизованого тестування

- **Backend (`pytest backend/tests`)**:
  - `301 passed, 4 skipped, 682 warnings in 37.98s`
  - 100% тестів пройдено успішно (включно з `test_auth.py`, `test_schedule_api.py`, `test_week.py`, `test_directory_admin.py`, `test_occurrence_notes_migration.py`).
- **Frontend (`npm run test:auth` + `npx tsc --noEmit`)**:
  - `7 passed, 0 failed` у `tests/auth-races.cjs`
  - TypeScript перевірка типів: `0 помилок`.

---

## 5. Список розбіжностей з описом у завданні

1. **Alembic Revision ID попередньої міграції**:
   - *У завданні було*: `down_revision = "20261102_add_academic_terms"`
   - *Фактично в коді*: Файл називається `20261102_add_academic_terms.py`, проте поле `revision` всередині файлу має значення `"20261102_academic_terms"`.
   - *Рішення*: У новій міграції встановлено `down_revision = "20261102_academic_terms"`, завдяки чому ланцюжок міграцій Alembic зберіг цілісність, а `alembic heads` коректно показує `20261105_perf_indexes (head)`.

2. **Назва колонки дати в моделі `ScheduleOverride`**:
   - *У ТЗ згадувалося*: `override_date`
   - *Фактично в `backend/app/models/entities.py:177`*: Колонка називається `date` (а поля перенесення — `moved_to_date` та `moved_to_lesson`).
   - *Рішення*: Індекс створено точно за існуючими в моделі колонками: `(group_id, moved_to_date, moved_to_lesson)`.

3. **Назви функцій хешування паролів у `security.py`**:
   - *У завданні було*: `get_password_hash_async`
   - *Фактично в `backend/app/core/security.py:20`*: Синхронна функція називається `hash_password(password: str) -> str`.
   - *Рішення*: Додано обидві функції `hash_password_async` та аліас `get_password_hash_async` для повної сумісності.
