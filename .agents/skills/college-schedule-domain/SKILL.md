---
name: college-schedule-domain
description: >-
  Domain reference for College Schedule PWA (ДФКР): bell schedules (standard 80-min and shortened 50-min days), live lesson logic, subgroups, online meeting link protection, Google Classroom tasks & automatic 12/5/100 grading scales, onboarding/GuideHub, SEO/sitemap rules, and Heroku SSR settings. Use when implementing or reviewing domain behavior, UI business rules, grading logic, bells, or SEO configuration in college-schedule.
---

# College Schedule PWA (ДФКР) — Доменна специфікація

Детальні бізнес-правила винесено з кореневого `GEMINI.md` у цей скіл за принципом **Progressive Disclosure**, щоб зменшити базовий контекст і виключити обрізання правил.

## Модулі домену (читай потрібний розділ за задачею)

| Домен | Коли відкривати | Файл довідки |
| :--- | :--- | :--- |
| **Дзвінки, підгрупи, онлайн-посилання, навігація, Гід** | Робота з парами, карткою уроку (`LessonCard`), часом Києва, свайпами, модальним пошуком чи `GuideHubModal` | [bells-subgroups-and-ui.md](./references/bells-subgroups-and-ui.md) |
| **Google Classroom, завдання, борги та шкали оцінок** | Синхронізація, фільтрація ДЗ, `MobileTasksView`, `GradesView`, `useGradesSummary`, сервіс синхронізації | [classroom-and-grades.md](./references/classroom-and-grades.md) |
| **SEO, Google Search Console, SSR та Heroku** | `robots.txt`, `sitemap.xml`, метатеги, SSR-таймаути (`ssrApi.ts`), автоімпорт `kre.dp.ua`, CP-SAT | [seo-and-deployment.md](./references/seo-and-deployment.md) |
