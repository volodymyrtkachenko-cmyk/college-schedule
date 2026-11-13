# College Schedule PWA (ДФКР) — Короткий гід і правила роботи

Дніпровський фаховий коледж радіоелектроніки. Цей кореневий файл навмисно тримається **< 12 KB** (ліміт Antigravity — 24 KB на rule-файл), щоб найкритичніші правила ніколи не обрізались. Детальні бізнес-правила винесено у скіл [.agents/skills/college-schedule-domain/SKILL.md](.agents/skills/college-schedule-domain/SKILL.md), а доменні деталі стеків — у [frontend/GEMINI.md](frontend/GEMINI.md) та [backend/GEMINI.md](backend/GEMINI.md).

---

## 1. Обов'язковий workflow для AI-агента (Git, Перевірки, Безпека)

1. **Суворий контроль якості перед push**:
   - Після завершення кодових змін обов'язково запустити релевантні перевірки до фінального коміту:
     - **Backend** (якщо змінювався `backend/`): `cd backend && ../.venv/bin/pytest -q`
     - **Frontend** (якщо змінювався `frontend/`): `cd frontend && npx tsc --noEmit && node --test tests/*.cjs && npm run check:contrast && npm run build`
   - Жоден коміт із помилками типів, падінням тестів, порушенням WCAG AA чи зламаним білдом не повинен потрапляти в `main`.
2. **Автоматичний коміт та push у `main` (завжди після завершення задачі)**:
   - Якщо задача містила зміни у коді чи конфігураціях і перевірки пройшли успішно — агент **самостійно** виконує `git status -s`, формує чистий(і) коміт(и) у стилі Conventional Commits та виконує `git push origin main` без очікування додаткового прохання користувача.
   - Якщо робота була лише дослідницькою або зупинена на етапі узгодження плану — нічого не пушити.
3. **Безпека та чистота даних**:
   - Ніколи не комітити реальні ключі, паролі, токени, `.env`, дампи БД, `.DS_Store` чи тимчасові логи.
   - Не додавати у клієнтські UI-компоненти захардкоджені реальні ПІБ чи фіксовані навчальні дати — використовувати динамічні дані з API або нейтральні демо-приклади.
4. **Підтримка документації**:
   - Тримати кореневий `GEMINI.md` компактним (`< 15 KB`); детальні специфікації фіч та бізнес-логіку складати у `.agents/skills/college-schedule-domain/references/`.

---

## 2. Призначення та технологічний стек

**College Schedule PWA** — прогресивний веб-застосунок розкладу занять, моніторингу освітнього процесу та інтеграції з Google Classroom для студентів, викладачів і адміністрації коледжу.

- **Frontend**: Next.js 14 (App Router, SSR/ISR для `/`, `/group/[code]`, `/teacher/[slug]`, `/bells`), React 18, TypeScript (Strict), Tailwind CSS + семантичні CSS-токени (`--sys-*`), Framer Motion (`<MotionConfig reducedMotion="user">`), `@ducanh2912/next-pwa` (`/~offline`), Google Identity Services OAuth 2.0.
- **Backend**: FastAPI (Python 3.12), PostgreSQL + SQLAlchemy 2.0 (`asyncio`, `psycopg` / `aiosqlite` у тестах), Alembic, Google OR-Tools CP-SAT (`solver.py`), `httpx`, `selectolax`, PyJWT, Argon2 (`pwdlib[argon2]`), `slowapi`, `Fernet`.

---

## 3. Актуальна структура репозиторію

```text
college-schedule/
├── .agents/
│   ├── hooks.json                      # Хук перевірки незапушених змін на Stop
│   ├── rules/git-workflow.md           # Правило автопушу
│   └── skills/college-schedule-domain/ # Детальні специфікації домену (дзвінки, Classroom, оцінки, SEO)
├── backend/
│   ├── alembic/                        # Міграції PostgreSQL
│   ├── app/
│   │   ├── main.py / worker.py         # FastAPI, lifespan та фоновий воркер
│   │   ├── config.py / database.py / analytics.py
│   │   ├── core/                       # crypto.py, security.py, time.py (KYIV_TZ), rate_limit.py
│   │   ├── models/                     # entities.py, lesson_notes.py (+ слухачі cache_rev)
│   │   ├── schemas/                    # Pydantic-схеми (admin_import.py, classroom.py, schedule_versions.py)
│   │   ├── routers/
│   │   │   ├── classroom/              # Тонкі роутери (__init__.py, sync.py, accounts.py, diagnostics.py)
│   │   │   ├── admin_import.py         # Тонкий роутер імпорту kre.dp.ua
│   │   │   └── schedule*.py, drafts.py, generator.py, statistics.py, settings.py, directory.py, auth.py
│   │   └── services/
│   │       ├── classroom/              # state.py, tokens.py, parser.py, storage.py, sync.py, worker.py
│   │       ├── importer/               # fetcher, kre_parser, differ, hashing, validation, orchestrator, migration, worker
│   │       └── projection.py, solver.py, bells.py, directory_cache.py, schedule_serializer.py, versions.py, ...
│   └── tests/                          # pytest suite (327+ тестів)
└── frontend/
    ├── app/                            # page.tsx, layout.tsx, globals.css, group/[code], teacher/[slug], bells, admin, settings, statistics, educational-process, sitemap.ts, robots.ts
    ├── components/
    │   ├── SchedulePageClient.tsx      # Координатор головного екрану (~600 рядків)
    │   ├── schedule/                   # Хуки (useScheduleSelection, useScheduleDataFetch, useKeyboardScheduleNav) та секції (DesktopToolbar, MobileChrome, DesktopScheduleSidebar, ContextSelectionModal...)
    │   ├── LessonCard.tsx              # Координатор картки пари (~900 рядків)
    │   ├── lesson-card/                # MeetingControls, StatusBadges, Actions, SubgroupTeacherBlock, TasksPanel
    │   └── admin/                      # AdminScheduleEditor, GeneratorPanel, GroupRosterModal, ImportPanel...
    ├── lib/
    │   ├── api.ts                      # Стабільний barrel-реекспорт із ./api/index
    │   ├── api/                        # types, errors, authStorage, client, schedule, classroom, planning, index
    │   ├── lesson-card/                # Чиста логіка картки (kyivClock, taskDeadlines, taskParser, onlineMeetings, dualTeacherTasks)
    │   ├── schedule/                   # Чиста логіка екрана розкладу (navigation, tasksAggregation)
    │   └── classroomTaskFilter.ts, ssrApi.ts, useGradesSummary.ts, useTaskGroups.ts, useClassroomSubmissions.ts, format.ts, shareImage.ts...
    ├── scripts/check-contrast.mjs      # Аудит WCAG AA (292+ комбінацій) і заборона transition-all у публічній зоні
    └── tests/                          # node --test tests/*.cjs + helpers/load-ts-module.cjs
```

---

## 4. Основні команди та змінні середовища

```bash
# Локальний запуск
./.venv/bin/uvicorn app.main:app --reload --port 8000 --app-dir backend
cd frontend && npm run dev

# Перевірки якості
cd backend && ../.venv/bin/pytest -q
cd frontend && npx tsc --noEmit && node --test tests/*.cjs && npm run check:contrast && npm run build
```

- **Backend env**: `DATABASE_URL`, `JWT_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CLASSROOM_FERNET_KEY`, `CLASSROOM_SYNC_INTERVAL_MINUTES`, `AUTO_IMPORT_ENABLED`, `AUTO_IMPORT_INTERVAL_MINUTES`, `BACKEND_CORS_ORIGINS`, `TEACHER_PIN`, `ADMIN_PASSWORD`, `RUN_CRON`.
- **Frontend env**: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
