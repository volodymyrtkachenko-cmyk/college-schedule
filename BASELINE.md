# BASELINE.md: Базові виміри швидкодії до оптимізацій

Дата: 2026-11-05
Коміт/стан: `origin/main` (до внесення змін)

---

## 1. Час відповіді `GET /api/schedule/week`
Параметри: `group_id=1`, `target_date=2026-11-02` (5 послідовних викликів):

| Замір | Час відповіді (мс) | Статус | SQL-запитів до БД | Примітка |
|---|---|---|---|---|
| Замір 1 | 45.44 мс | 200 OK | 13 | Холодний старт проекції (промах `_WEEK_PROJ_CACHE`) |
| Замір 2 | 4.44 мс | 200 OK | 3 | Хіт `_WEEK_PROJ_CACHE`, але виконуються `attach_notes` та `_active_periods` |
| Замір 3 | 3.53 мс | 200 OK | 3 | Хіт `_WEEK_PROJ_CACHE` |
| Замір 4 | 3.64 мс | 200 OK | 3 | Хіт `_WEEK_PROJ_CACHE` |
| Замір 5 | 3.01 мс | 200 OK | 3 | Хіт `_WEEK_PROJ_CACHE` |

**Медіана часу відповіді**: **3.64 мс** (локальний ASGI-тест).

---

## 2. Кількість запитів до бази даних при одному відкритті головної сторінки

При початковому завантаженні головної сторінки (`frontend/app/page.tsx`) клієнт генерує наступні API-запити:
1. `GET /api/schedule/week?group_id=1&target_date=...`: **13 SQL-запитів** (при холодному кеші) або **3 SQL-запити** (при теплому кеші).
2. `GET /api/classroom/groups/1/status`: **3 SQL-запити** (`Group`, `ClassroomGroupBinding`, `LessonOccurrenceNote`).
3. `GET /api/ping`: викликається **двічі** через подвійний `useEffect` у `Heartbeat.tsx:70,138` (0 SQL-запитів, in-memory).
4. `GET /api/schedule/week?target_date=<тиждень - 7>` (через 350 мс у `prefetchAdjacentWeeks`): **13 SQL-запитів**.
5. `GET /api/schedule/week?target_date=<тиждень + 7>` (через 350 мс у `prefetchAdjacentWeeks`): **13 SQL-запитів**.

**Загальна кількість SQL-запитів до БД на старті**:
- При холодному кеші: **42 SQL-запити**.
- При теплому кеші: **12 SQL-запитів** (3 + 3 + 3 + 3).

---

## 3. План виконання запитів (`EXPLAIN QUERY PLAN`)

### Запит 1: Фільтрація студентів за `lower(email)`
```sql
EXPLAIN QUERY PLAN
SELECT * FROM group_students WHERE lower(email) = 'student1@dfkr.dp.ua';
```
- **Результат плану**:
  `SCAN group_students`
- **Проблема**: Повне послідовне сканування таблиці (Full Table Scan) на кожному запиті розкладу з поштою через відсутність функціонального індексу на `lower(email)`.

### Запит 2: Фільтрація чернеток за `draft_type`, `status` з сортуванням по `id DESC`
```sql
EXPLAIN QUERY PLAN
SELECT * FROM schedule_drafts
WHERE draft_type = 'auto_import' AND status = 'pending'
ORDER BY id DESC;
```
- **Результат плану**:
  `SCAN schedule_drafts`
- **Проблема**: Повне послідовне сканування таблиці (Full Table Scan) на кожній перевірці чернеток імпорту / генератора через відсутність складеного індексу `(draft_type, status, id DESC)`.

---

## 4. Стан заголовків відповідей `Cache-Control` та `Vary` (до змін)

- Ендпоінт `GET /api/schedule/today` та `GET /api/schedule/week`:
  - `Vary`: `Date, Origin, Accept-Encoding, X-Classroom-User-Id, X-Classroom-Email, X-Teacher-Pin, Authorization`
  - Заголовок `Date` у `Vary` нівелює роботу `s-maxage=15` на рівні спільних проксі/CDN.
  - Навіть при передачі ключів авторизації виставляється `public, max-age=0, s-maxage=15`.
- Ендпоінт `GET /api/directory/teacher-subjects`:
  - Заголовок `Cache-Control`: **відсутній**.
  - In-memory кешування `_DIR_CACHE`: **відсутнє** (щоразу виконується 2 `SELECT DISTINCT` запити до таблиці `schedule`).

---

## 5. Стан ключів `localStorage` на фронтенді (до змін)

- У `frontend/lib/api.ts:469-470`:
  - Читаються ключі: `schedule_classroom_google_user_id` та `schedule_classroom_linked_email` (з підкресленням).
  - При вході записуються ключі: `schedule:classroom_google_user_id` та `schedule:classroom_linked_email` (з двокрапкою).
  - **Наслідок**: HTTP-заголовки `X-Classroom-User-Id` та `X-Classroom-Email` ніколи не потрапляють у запити, а натомість `attachClassroomQueryParams()` додає їх у URL query-параметри, руйнуючи спільне кешування та створюючи витік PII в URL.
