import type { Metadata } from "next";
import { TransitionLink } from "../components/navigation/NavigationTransitionProvider";
import { SchedulePageClient } from "../components/SchedulePageClient";
import { SITE_URL } from "../lib/site";
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

  return (
    <div className="min-h-dvh bg-transparent text-sys-text-primary">
      <h1 className="sr-only">
        Розклад ДФКР — Дніпровський фаховий коледж радіоелектроніки
      </h1>

      <SchedulePageClient initialGroups={groups} initialTeachers={teachers} />

      <footer className="mx-auto max-w-6xl border-t border-sys-border/60 px-4 pt-4 pb-24 text-xs text-sys-text-secondary sm:px-6 lg:pb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Дніпровський фаховий коледж радіоелектроніки (ДФКР)
          </p>
          <nav aria-label="Розділи розкладу ДФКР" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <TransitionLink href="/groups" className="hover:text-sys-accent hover:underline">
              Групи
            </TransitionLink>
            <TransitionLink href="/teachers" className="hover:text-sys-accent hover:underline">
              Викладачі
            </TransitionLink>
            <TransitionLink href="/bells" className="hover:text-sys-accent hover:underline">
              Дзвінки
            </TransitionLink>
            <TransitionLink href="/educational-process" className="hover:text-sys-accent hover:underline">
              Графік процесу
            </TransitionLink>
            <TransitionLink href="/statistics" className="hover:text-sys-accent hover:underline">
              Статистика
            </TransitionLink>
            <a
              href="https://kre.dp.ua/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-sys-accent hover:underline"
            >
              kre.dp.ua
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
