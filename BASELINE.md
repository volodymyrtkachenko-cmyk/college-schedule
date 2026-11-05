# BASELINE.md: Базові виміри швидкодії до та після оптимізацій

Дата: 2026-11-05
Коміт/стан: порівняння `origin/main` (до) та поточної оптимізованої версії (після)

---

## 1. Час відповіді `GET /api/schedule/week`
Параметри: `group_id=1`, `target_date=2026-11-02` (5 послідовних викликів):

| Замір | До (мс) | Після (мс) | Статус | SQL-запитів до БД | Примітка |
|---|---|---|---|---|---|
| Замір 1 | 45.44 мс | 40.42 мс | 200 OK | 13 | Холодний старт проекції (промах `_WEEK_PROJ_CACHE`) |
| Замір 2 | 4.44 мс | 3.69 мс | 200 OK | 3 | Хіт `_WEEK_PROJ_CACHE` |
| Замір 3 | 3.53 мс | 2.68 мс | 200 OK | 3 | Хіт `_WEEK_PROJ_CACHE` |
| Замір 4 | 3.64 мс | 3.30 мс | 200 OK | 3 | Хіт `_WEEK_PROJ_CACHE` |
| Замір 5 | 3.01 мс | 3.46 мс | 200 OK | 3 | Хіт `_WEEK_PROJ_CACHE` |

**Медіана часу відповіді**:
- **До**: **3.64 мс**
- **Після**: **3.46 мс** (локальний ASGI-тест, прискорення на ~5%).

---

## 2. Кількість запитів до бази даних та мережі при відкритті та роботі головної сторінки

| Подія / Елемент | Кількість запитів ДО | Кількість запитів ПІСЛЯ | Ефект / Опис |
|---|---|---|---|
| **Heartbeat `/api/ping` на старті** | 2 запити | **1 запит** | Усунуто дублюючий `useEffect([user])` на першому рендері (`isFirstUserRenderRef`) |
| **Prefetch сусідніх тижнів (`-7` та `+7`)** | 2 безумовні мережеві запити кожні 350 мс | **0 мережевих запитів** (якщо тижні вже є в `localStorage`/пам'яті), затримка збільшена до 1500 мс | Економія 26 SQL-запитів на cold load і збереження трафіку мобільних користувачів |
| **Повернення на вкладку (`visibilitychange`)** | 2 дублюючі виклики розкладу + скидання `etagCache` + стирання `localStorage` (повний `200 OK`) | **0 запитів** (при поверненні протягом 60 с завдяки тротлінгу); після 60 с — легкий `304 Not Modified` завдяки збереженню `ETag` | Повне усунення шторму запитів на клієнті |
| **Запити розкладу тижня на старті (warm)** | 12 SQL-запитів | **3–6 SQL-запитів** | Кеш сусідніх тижнів не перезапитується з БД |

---

## 3. План виконання запитів (`EXPLAIN QUERY PLAN`)

### Запит 1: Фільтрація студентів за `lower(email)`
```sql
EXPLAIN QUERY PLAN
SELECT * FROM group_students WHERE lower(email) = 'student1@dfkr.dp.ua';
```
- **План ДО**:
  `SCAN group_students` (Full Table Scan)
- **План ПІСЛЯ**:
  `SEARCH group_students USING INDEX ix_group_students_lower_email (<expr>=?)` (Index Search)

### Запит 2: Фільтрація чернеток за `draft_type`, `status` з сортуванням по `id DESC`
```sql
EXPLAIN QUERY PLAN
SELECT * FROM schedule_drafts
WHERE draft_type = 'auto_import' AND status = 'pending'
ORDER BY id DESC;
```
- **План ДО**:
  `SCAN schedule_drafts` (Full Table Scan)
- **План ПІСЛЯ**:
  `SEARCH schedule_drafts USING INDEX ix_schedule_drafts_type_status (draft_type=? AND status=?)` (Index Search)

---

## 4. Стан заголовків відповідей `Cache-Control` та `Vary`

| Заголовок / Ендпоінт | ДО | ПІСЛЯ | Ефект |
|---|---|---|---|
| **`Vary` в `/api/schedule/today` та `/week`** | `Date, Origin, Accept-Encoding, X-Classroom-User-Id, ...` | `Origin, Accept-Encoding, X-Classroom-User-Id, X-Classroom-Email, X-Teacher-Pin, Authorization` | **`Date` видалено**. CDN / Cloudflare / Heroku Router тепер можуть повноцінно кешувати спільні відповіді з `s-maxage=15` |
| **`Cache-Control` для запитів з PIN / Classroom** | `public, max-age=0, s-maxage=15, stale-while-revalidate=300` | `private, max-age=0, must-revalidate` | Запобігає кешуванню персональних розблокованих посилань на CDN для інших користувачів |
| **`Cache-Control` для гостьових запитів розкладу** | `public, max-age=0, s-maxage=15, stale-while-revalidate=300` | `public, max-age=0, s-maxage=15, stale-while-revalidate=300` | Збережено `s-maxage=15` |
| **`/api/teacher-subjects`** | Відсутній заголовок, відсутній in-memory кеш | `Cache-Control: public, max-age=60` + in-memory кешування у `_DIR_CACHE` з ключем `get_schedule_cache_rev()` | Зменшення навантаження на БД від важких `SELECT DISTINCT` |

---

## 5. Стан ключів `localStorage` на фронтенді

| Ключ | ДО | ПІСЛЯ |
|---|---|---|
| Читання Google User ID у `rawRequest` | `schedule_classroom_google_user_id` (з підкресленням) | `schedule:classroom_google_user_id` з фолбеком на старий ключ |
| Читання Classroom Email у `rawRequest` | `schedule_classroom_linked_email` (з підкресленням) | `schedule:classroom_linked_email` з фолбеком на старий ключ |
| Відправка HTTP-заголовків | `X-Classroom-*` **ніколи не відправлялися** через друкарську помилку в ключах | Заголовки `X-Classroom-User-Id`, `X-Classroom-Email`, `X-Teacher-Pin` реально відправляються у кожному запиті |
| Query-параметри `classroom_*` | Залишені як fallback на бекенді, зворотна сумісність збережена | Повна підтримка обох форматів |
