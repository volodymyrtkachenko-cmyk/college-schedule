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
  const ssrNowIso = new Date().toISOString();

  return (
    <div className="min-h-dvh bg-transparent text-sys-text-primary">
      <h1 className="sr-only">
        Розклад ДФКР — Дніпровський фаховий коледж радіоелектроніки
      </h1>

      <SchedulePageClient initialGroups={groups} initialTeachers={teachers} ssrNowIso={ssrNowIso} />

      <footer className="mx-auto max-w-6xl border-t border-sys-border/60 px-3 pt-3 pb-bottom-nav-safe text-[11px] text-sys-text-secondary sm:px-6 sm:pt-4 sm:text-xs lg:pb-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <p className="truncate sm:whitespace-normal">
            <span className="sm:hidden">ДФКР — розклад занять</span>
            <span className="hidden sm:inline">Дніпровський фаховий коледж радіоелектроніки (ДФКР)</span>
          </p>
          <nav aria-label="Розділи розкладу ДФКР" className="flex flex-wrap items-center gap-x-2 min-[390px]:gap-x-2.5 gap-y-1 sm:gap-x-4 sm:gap-y-1.5">
            <TransitionLink href="/groups" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              Групи
            </TransitionLink>
            <TransitionLink href="/teachers" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              Викладачі
            </TransitionLink>
            <TransitionLink href="/bells" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              Дзвінки
            </TransitionLink>
            <TransitionLink href="/educational-process" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              <span className="sm:hidden">Графік</span>
              <span className="hidden sm:inline">Графік процесу</span>
            </TransitionLink>
            <TransitionLink href="/statistics" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              Статистика
            </TransitionLink>
            <a
              href="https://kre.dp.ua/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-sys-accent hover:underline whitespace-nowrap"
            >
              kre.dp.ua
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
