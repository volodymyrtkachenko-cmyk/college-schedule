# SEO, Google Search Console, Sitemap та Heroku SSR

## 1. `robots.txt` та `sitemap.xml`
- **`robots.txt`** (`frontend/app/robots.ts`):
  - Єдине правило `userAgent: "*"` із `allow: "/"` (без дублювання окремих конфліктних блоків `Googlebot`).
  - `disallow: ["/admin", "/login", "/settings", "/~offline", "/api/"]`.
  - `sitemap: ${siteUrl}/sitemap.xml` та `host: siteUrl` із нормалізацією кінцевих слешів (`replace(/\/+$/, "")`).
- **`sitemap.xml`** (`frontend/app/sitemap.ts`):
  - ISR-кешування `export const revalidate = 3600;` (1 година) для миттєвої віддачі без холодного старту бекенду.
  - Нормалізація `SITE_URL.replace(/\/+$/, "")`, щоб не було `//`.
  - W3C-дата `new Date().toISOString().split("T")[0]` (тільки `YYYY-MM-DD`, без секунд/мілісекунд).
  - Фільтрація некоректних груп та викладачів (без порожніх імен чи `/teacher/teacher`).

## 2. SSR, Schema.org та Google Search Console
- **Сторінки**: `/` (головна), `/group/[code]`, `/teacher/[slug]`, `/bells`, `/statistics`, `/educational-process` із Schema.org (`Course`, `Person`, `FAQPage`).
- **Критичне SEO-правило**: на головній сторінці `/` **ніколи** не перезаписувати `document.title` назвою конкретної групи або викладача.
- **Google Search Console**:
  - HTML-файл верифікації: `frontend/public/googlec5560073f40db86d.html`.
  - Мета-тег `<meta name="google-site-verification">` у `layout.tsx` має містити саме токен верифікації (`-m7HP31Px4meRbaw-1zbMKXBsj_0JY7` або `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`), не ім'я HTML-файлу.
- **Бекенд Heroku + SSR**:
  - `BACKEND_API_URL` централізовано в `frontend/lib/site.ts`.
  - Таймаут у `frontend/lib/ssrApi.ts` — 8 секунд для очікування пробудження dyno без зриву SSR-генерації.
