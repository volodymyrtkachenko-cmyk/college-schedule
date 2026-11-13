# Frontend Rules (`frontend/`)

1. **Контраст і Tailwind CSS (`scripts/check-contrast.mjs`)**:
   - Не використовувати `transition-all` у публічних компонентах зі списку `publicNoTransitionAll` у `scripts/check-contrast.mjs` (застосовувати `transition-colors`, `transition-opacity`, `transition-transform`).
   - При додаванні нових файлів у `components/lesson-card/`, `components/schedule/` чи публічних сторінок додавати їх у `publicNoTransitionAll`.
   - У всіх `.tsx` файлах будь-який пастельний клас `text-<color>-(100|200|300|400)` без `dark:` повинен мати адаптацію для світлої теми (`text-<color>-(600..950) dark:text-...`) **у тому самому рядку**.
   - Кольори дизайн-системи (WCAG AA): `--bg`, `--sys-card`, `--sys-elevated`, `--sys-text-primary`, `--sys-text-secondary`, `--sys-text-muted` (контраст >= 4.7:1), `--sys-accent`, `--sys-accent-solid`; токени анімації `duration-fast` (150ms), `duration-base` (240ms), `duration-slow` (320ms), `duration-page` (280ms), View Transitions API (240ms).

2. **Next.js App Router, SSR і PWA**:
   - Не ламати SSR/SSG для `/`, `/group/[code]`, `/teacher/[slug]`, `/bells`, `/sitemap.xml` — на головній сторінці `/` ніколи не перезаписувати `document.title` конкретною групою чи викладачем.
   - Клієнтські модалки та важкі інтерактивні віджети підключати через `next/dynamic(..., { ssr: false })`.
   - Для клієнтських логік часу/пар уникати розбіжностей гідрації (переносити `Date`-залежні зсуви після монтування).

3. **Модульність і тести**:
   - Доменна чиста логіка (`lib/api/*`, `lib/lesson-card/*`, `lib/schedule/*`) не повинна імпортувати React чи TSX, щоб тестуватися через `node --test tests/*.cjs` (рекурсивний VM-лоадер `tests/helpers/load-ts-module.cjs`).
   - Обов'язковий прогін перед комітом:
     `cd frontend && npx tsc --noEmit && node --test tests/*.cjs && npm run check:contrast && npm run build`
