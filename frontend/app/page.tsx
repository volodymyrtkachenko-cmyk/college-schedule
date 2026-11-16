import type { Metadata } from "next";
import { SchedulePageClient } from "../components/SchedulePageClient";
import { SITE_URL } from "../lib/site";
import { toTeacherSlug } from "../lib/slug";
import { fetchDirectoryForSsr } from "../lib/ssrApi";

export const revalidate = 1800; // Revalidate directory data for SEO every 30 minutes

export const metadata: Metadata = {
  title: {
    absolute: "Розклад ДФКР",
  },
  description:
    "Офіційний електронний розклад занять Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ). Розклад занять усіх навчальних груп, викладачів, розклад дзвінків, жива пара та Google Classroom.",
  alternates: {
    canonical: `${SITE_URL}/`,
  },
  openGraph: {
    title: "Розклад ДФКР — коледж радіоелектроніки",
    description:
      "Офіційний електронний розклад занять Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ). Розклад усіх навчальних груп, викладачів, розклад дзвінків та Google Classroom.",
    url: `${SITE_URL}/`,
    type: "website",
    locale: "uk_UA",
    siteName: "Розклад ДФКР",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Розклад ДФКР — коледж радіоелектроніки",
    description:
      "Офіційний електронний розклад занять ДФКР: групи, викладачі, дзвінки та Google Classroom.",
    images: ["/og-image.png"],
  },
};

export default async function HomePage() {
  const { groups, teachers } = await fetchDirectoryForSsr();
  const ssrNowIso = new Date().toISOString();

  return (
    <div className="min-h-dvh bg-transparent text-sys-text-primary">
      <h1 className="sr-only">
        Розклад ДФКР — Дніпровський фаховий коледж радіоелектроніки
      </h1>

      <SchedulePageClient initialGroups={groups} initialTeachers={teachers} ssrNowIso={ssrNowIso} />

      <section className="sr-only" aria-label="Довідник розкладу занять ДФКР">
        <h2>Електронний розклад занять Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ)</h2>
        <p>
          Актуальний розклад пар для студентів усіх навчальних груп і викладачів коледжу: розклад на
          сьогодні та тиждень, чисельник і знаменник, заміни занять, розклад дзвінків та інтеграція з
          Google Classroom.
        </p>
        {groups.length > 0 && (
          <div>
            <h3>Розклад навчальних груп ДФКР</h3>
            <ul>
              {groups.map((g) => (
                <li key={g.id}>
                  <a href={`/group/${encodeURIComponent(g.name)}`}>Група {g.name}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {teachers.length > 0 && (
          <div>
            <h3>Розклад викладачів ДФКР</h3>
            <ul>
              {teachers.map((t) => (
                <li key={t.id}>
                  <a href={`/teacher/${toTeacherSlug(t.name)}`}>{t.name}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <nav aria-label="Розділи розкладу ДФКР">
          <ul>
            <li>
              <a href="/groups">Усі навчальні групи</a>
            </li>
            <li>
              <a href="/teachers">Усі викладачі</a>
            </li>
            <li>
              <a href="/bells">Розклад дзвінків</a>
            </li>
            <li>
              <a href="/educational-process">Графік освітнього процесу</a>
            </li>
            <li>
              <a href="/statistics">Статистика розкладу</a>
            </li>
            <li>
              <a href="https://kre.dp.ua/" target="_blank" rel="noopener noreferrer">
                Офіційний сайт ДФКР (kre.dp.ua)
              </a>
            </li>
          </ul>
        </nav>
      </section>
    </div>
  );
}
