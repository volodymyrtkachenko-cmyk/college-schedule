import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SchedulePageClient } from "../../../components/SchedulePageClient";
import { TransitionLink } from "../../../components/navigation/NavigationTransitionProvider";
import { SITE_URL } from "../../../lib/site";
import { getMondayCalendarIso } from "../../../lib/calendarDate";
import { formatKyivDateIso, getKyivInitialWeekAnchor } from "../../../lib/date";
import { findTeacherBySlug, toTeacherSlug } from "../../../lib/slug";
import {
  fetchDirectoryForSsr,
  fetchScheduleWeekForSsr,
} from "../../../lib/ssrApi";

export const revalidate = 3600; // Оновлення кожну годину (ISR)

const UKR_WEEKDAYS = [
  "Неділя",
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П'ятниця",
  "Субота",
];

function getDayTitle(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    const name = UKR_WEEKDAYS[d.getDay()] || "Навчальний день";
    return `${name} (${dateStr})`;
  } catch {
    return dateStr;
  }
}

export async function generateStaticParams() {
  const { teachers } = await fetchDirectoryForSsr();
  return teachers.map((t) => ({
    slug: toTeacherSlug(t.name),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const rawSlug = decodeURIComponent(params.slug || "");
  const { teachers } = await fetchDirectoryForSsr();
  const teacher = findTeacherBySlug(teachers, rawSlug);

  if (!teacher) {
    return {
      title: "Розклад викладача — ДФКР",
      description: "Розклад викладачів Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ).",
    };
  }

  const title = `Розклад викладача ${teacher.name} — ДФКР`;
  const description = `Актуальний розклад занять викладача ${teacher.name} у Дніпровському фаховому коледжі радіоелектроніки (ДФКР / КРЕ). Пари на тиждень, чисельник і знаменник, навчальні групи, аудиторії та розклад дзвінків.`;
  const url = `${SITE_URL}/teacher/${toTeacherSlug(teacher.name)}`;

  return {
    title,
    description,
    keywords: [
      `розклад ${teacher.name}`,
      `розклад викладача ${teacher.name}`,
      `${teacher.name} дфкр`,
      "викладачі дфкр",
      "розклад викладачів дфкр",
      "розклад дфкр",
    ],
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      locale: "uk_UA",
      siteName: "Розклад ДФКР",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export default async function TeacherSchedulePage({
  params,
}: {
  params: { slug: string };
}) {
  const rawSlug = decodeURIComponent(params.slug || "");
  const { groups, teachers } = await fetchDirectoryForSsr();

  const teacher = findTeacherBySlug(teachers, rawSlug);

  if (!teacher && teachers.length > 0) {
    notFound();
  }

  const ssrNow = new Date();
  const ssrNowIso = ssrNow.toISOString();
  const targetWeekAnchorIso = formatKyivDateIso(getKyivInitialWeekAnchor(ssrNow));
  const teacherId = teacher?.id;
  const scheduleDays = teacherId
    ? await fetchScheduleWeekForSsr({ teacherId, targetDateIso: targetWeekAnchorIso })
    : [];
  const initialWeekStartIso =
    scheduleDays.length > 0 && scheduleDays[0]?.date
      ? getMondayCalendarIso(scheduleDays[0].date)
      : undefined;
  const teacherName = teacher?.name || rawSlug;

  const teacherUrl = `${SITE_URL}/teacher/${toTeacherSlug(teacherName)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${teacherUrl}#webpage`,
        url: teacherUrl,
        name: `Розклад викладача ${teacherName} — ДФКР`,
        inLanguage: "uk-UA",
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
      {
        "@type": "Person",
        name: teacherName,
        jobTitle: "Викладач",
        worksFor: {
          "@type": "EducationalOrganization",
          "@id": "https://kre.dp.ua/#organization",
          name: "Дніпровський фаховий коледж радіоелектроніки",
          sameAs: "https://kre.dp.ua/",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Головна",
            item: SITE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Викладачі ДФКР",
            item: `${SITE_URL}/teachers`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: teacherName,
            item: teacherUrl,
          },
        ],
      },
    ],
  };

  return (
    <div className="min-h-dvh bg-transparent text-sys-text-primary">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <h1 className="sr-only">
        Розклад викладача {teacherName} — Дніпровський фаховий коледж радіоелектроніки (ДФКР)
      </h1>

      <SchedulePageClient
        initialGroups={groups}
        initialTeachers={teachers}
        initialTeacherId={teacherId}
        initialMode="teacher"
        initialWeek={scheduleDays}
        initialWeekStartIso={initialWeekStartIso}
        ssrNowIso={ssrNowIso}
      />

      <footer className="mx-auto max-w-6xl border-t border-sys-border/60 px-3 pt-3 pb-bottom-nav-safe text-[11px] text-sys-text-secondary sm:px-6 sm:pt-4 sm:text-xs lg:pb-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <p className="truncate sm:whitespace-normal">
            Викладач <strong className="text-sys-text-primary">{teacherName}</strong> · ДФКР
          </p>
          <nav aria-label="Розділи розкладу ДФКР" className="flex flex-wrap items-center gap-x-2 min-[390px]:gap-x-2.5 gap-y-1 sm:gap-x-4 sm:gap-y-1.5">
            <TransitionLink href="/" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              Головна
            </TransitionLink>
            <TransitionLink href="/teachers" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              <span className="sm:hidden">Викладачі</span>
              <span className="hidden sm:inline">Усі викладачі</span>
            </TransitionLink>
            <TransitionLink href="/groups" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              <span className="sm:hidden">Групи</span>
              <span className="hidden sm:inline">Навчальні групи</span>
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
          </nav>
        </div>
      </footer>

      {scheduleDays.length > 0 && (
        <noscript>
          <section style={{ maxWidth: "800px", margin: "16px auto", padding: "0 16px" }}>
            <h2>Розклад занять викладача {teacherName}</h2>
            {scheduleDays.map((day, idx) => (
              <div key={day.date || idx}>
                <h3>{getDayTitle(day.date)}</h3>
                {day.lessons && day.lessons.length > 0 ? (
                  <ul>
                    {day.lessons.map((lesson, lIdx) => (
                      <li key={lesson.id || lIdx}>
                        <strong>{lesson.lesson_number} пара ({lesson.time}):</strong>{" "}
                        {lesson.subject_name || lesson.subject || "Заняття"} —{" "}
                        група {lesson.group_name || "Група"}
                        {lesson.room ? `, ауд. ${lesson.room}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Цього дня пар за розкладом немає.</p>
                )}
              </div>
            ))}
          </section>
        </noscript>
      )}
    </div>
  );
}
