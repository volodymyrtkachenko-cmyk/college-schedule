import { SchedulePageClient } from "../components/SchedulePageClient";
import type { ReferenceRecord } from "../lib/api";

export const revalidate = 1800; // Revalidate directory data for SEO every 30 minutes

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://backend-agile-driftwood-8589.fly.dev";

async function fetchInitialDirectory(): Promise<{
  groups: ReferenceRecord[];
  teachers: ReferenceRecord[];
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const [groupsRes, teachersRes] = await Promise.all([
      fetch(`${API_URL}/api/groups`, {
        next: { revalidate: 1800 },
        signal: controller.signal,
      }),
      fetch(`${API_URL}/api/teachers`, {
        next: { revalidate: 1800 },
        signal: controller.signal,
      }),
    ]);
    clearTimeout(timeoutId);

    const groups: ReferenceRecord[] = groupsRes.ok ? await groupsRes.json() : [];
    const teachers: ReferenceRecord[] = teachersRes.ok ? await teachersRes.json() : [];
    return {
      groups: Array.isArray(groups) ? groups : [],
      teachers: Array.isArray(teachers) ? teachers : [],
    };
  } catch {
    return { groups: [], teachers: [] };
  }
}

export default async function HomePage() {
  const { groups, teachers } = await fetchInitialDirectory();

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-dvh bg-transparent text-sys-text-primary outline-none"
    >
      <h1 className="sr-only">
        Розклад ДФКР — Розклад занять Дніпровського фахового коледжу радіоелектроніки
      </h1>

      <section
        aria-label="Розклад ДФКР — інформація про розклад занять коледжу"
        className="sr-only"
      >
        <h2>Розклад ДФКР — електронний розклад занять для студентів та викладачів</h2>
        <p>
          Розклад ДФКР (Дніпровський фаховий коледж радіоелектроніки, КРЕ, ДКРЕ, kre.dp.ua) — актуальний онлайн-розклад занять
          на сьогодні та на тиждень (чисельник і знаменник) для всіх навчальних груп 1–4 курсів та викладачів коледжу.
          Веб-застосунок Розклад ДФКР підтримує відстеження поточної живої пари в реальному часі, номери аудиторій, посилання на
          онлайн-заняття Google Meet і Zoom, а також автоматичну синхронізацію домашніх завдань та оцінок із Google Classroom.
        </p>

        <h2>Розклад дзвінків ДФКР (КРЕ)</h2>
        <ul>
          <li>1 пара: 09:00 – 10:20 (перерва 20 хвилин)</li>
          <li>2 пара: 10:40 – 12:00 (велика перерва 30 хвилин)</li>
          <li>3 пара: 12:30 – 13:50 (перерва 10 хвилин)</li>
          <li>4 пара: 14:00 – 15:20</li>
          <li>Скорочені дні: початок о 09:00, тривалість кожної пари 50 хвилин, перерви по 10 хвилин.</li>
        </ul>

        {groups.length > 0 && (
          <div>
            <h2>Навчальні групи ДФКР</h2>
            <p>Розклад занять для груп: {groups.map((g) => g.name).join(", ")}.</p>
          </div>
        )}

        {teachers.length > 0 && (
          <div>
            <h2>Викладачі ДФКР</h2>
            <p>Розклад викладачів коледжу: {teachers.map((t) => t.name).join(", ")}.</p>
          </div>
        )}

        <nav aria-label="Розділи розкладу ДФКР">
          <ul>
            <li><a href="/">Розклад занять ДФКР на сьогодні та тиждень</a></li>
            <li><a href="/educational-process">Графік освітнього процесу ДФКР (семестри, сесії, практики, канікули)</a></li>
            <li><a href="/statistics">Статистика занять та навчального навантаження викладачів ДФКР</a></li>
            <li><a href="https://kre.dp.ua/" rel="noopener noreferrer">Офіційний сайт Дніпровського фахового коледжу радіоелектроніки (kre.dp.ua)</a></li>
          </ul>
        </nav>
      </section>

      <SchedulePageClient initialGroups={groups} initialTeachers={teachers} />
    </main>
  );
}
