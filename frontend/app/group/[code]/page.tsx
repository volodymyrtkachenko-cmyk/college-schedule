import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SchedulePageClient } from "../../../components/SchedulePageClient";
import { TransitionLink } from "../../../components/navigation/NavigationTransitionProvider";
import { SITE_URL } from "../../../lib/site";
import { getMondayCalendarIso } from "../../../lib/calendarDate";
import { formatKyivDateIso, getKyivInitialWeekAnchor } from "../../../lib/date";
import {
  getGroupCourse,
  getGroupFullCode,
  getGroupSpecialtyName,
} from "../../../lib/groupInfo";
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
  const { groups } = await fetchDirectoryForSsr();
  return groups.map((g) => ({
    code: encodeURIComponent(g.name),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: { code: string };
}): Promise<Metadata> {
  const rawCode = decodeURIComponent(params.code || "");
  const { groups } = await fetchDirectoryForSsr();
  const group = groups.find(
    (g) => g.name.toLowerCase() === rawCode.toLowerCase()
  );

  if (!group) {
    return {
      title: `Розклад групи ${rawCode} — ДФКР`,
      description: `Розклад занять групи ${rawCode} Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ).`,
    };
  }

  const fullCode = getGroupFullCode(group);
  const course = getGroupCourse(group.name);
  const specialty = getGroupSpecialtyName(group.faculty_id);
  const courseText = course ? `${course} курс, ` : "";

  const title = `Розклад групи ${group.name} ДФКР (${fullCode})`;
  const description = `Актуальний розклад занять групи ${group.name} (${fullCode}, ${courseText}${specialty}) Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ). Пари на тиждень, чисельник і знаменник, аудиторії, розклад дзвінків.`;
  const url = `${SITE_URL}/group/${encodeURIComponent(group.name)}`;

  return {
    title,
    description,
    keywords: [
      `розклад ${group.name}`,
      `розклад групи ${group.name} дфкр`,
      `група ${group.name} кре`,
      `розклад занять ${fullCode}`,
      "розклад дфкр",
      course ? `дфкр ${course} курс` : specialty,
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

export default async function GroupSchedulePage({
  params,
}: {
  params: { code: string };
}) {
  const rawCode = decodeURIComponent(params.code || "");
  const { groups, teachers } = await fetchDirectoryForSsr();

  const group = groups.find(
    (g) => g.name.toLowerCase() === rawCode.toLowerCase()
  );

  if (!group && groups.length > 0) {
    notFound();
  }

  const ssrNow = new Date();
  const ssrNowIso = ssrNow.toISOString();
  const targetWeekAnchorIso = formatKyivDateIso(getKyivInitialWeekAnchor(ssrNow));
  const groupId = group?.id;
  const scheduleDays = groupId
    ? await fetchScheduleWeekForSsr({ groupId, targetDateIso: targetWeekAnchorIso })
    : [];
  const initialWeekStartIso =
    scheduleDays.length > 0 && scheduleDays[0]?.date
      ? getMondayCalendarIso(scheduleDays[0].date)
      : undefined;

  const fullCode = group ? getGroupFullCode(group) : rawCode;
  const course = group ? getGroupCourse(group.name) : null;
  const specialty = group ? getGroupSpecialtyName(group.faculty_id) : "";

  const pageUrl = `${SITE_URL}/group/${encodeURIComponent(group?.name || rawCode)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: `Розклад занять групи ${group?.name || rawCode} (${fullCode})`,
        description: `Розклад навчальних занять групи ${group?.name || rawCode} Дніпровського фахового коледжу радіоелектроніки. Спеціальність: ${specialty}.`,
        inLanguage: "uk-UA",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: {
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
            name: "Навчальні групи",
            item: `${SITE_URL}/groups`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: `Група ${group?.name || rawCode}`,
            item: pageUrl,
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
        Розклад групи {group?.name || rawCode} ДФКР — {fullCode}
      </h1>

      <SchedulePageClient
        initialGroups={groups}
        initialTeachers={teachers}
        initialGroupId={groupId}
        initialMode="student"
        initialWeek={scheduleDays}
        initialWeekStartIso={initialWeekStartIso}
        ssrNowIso={ssrNowIso}
      />

      <footer className="mx-auto max-w-6xl border-t border-sys-border/60 px-3 pt-3 pb-bottom-nav-safe text-[11px] text-sys-text-secondary sm:px-6 sm:pt-4 sm:text-xs lg:pb-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <p className="truncate sm:whitespace-normal">
            Група <strong className="text-sys-text-primary">{group?.name || rawCode}</strong> ({fullCode}
            {course ? `, ${course} курс` : ""})
            <span className="hidden sm:inline"> · {specialty}</span> · ДФКР
          </p>
          <nav aria-label="Розділи розкладу ДФКР" className="flex flex-wrap items-center gap-x-2 min-[390px]:gap-x-2.5 gap-y-1 sm:gap-x-4 sm:gap-y-1.5">
            <TransitionLink href="/" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              Головна
            </TransitionLink>
            <TransitionLink href="/groups" className="hover:text-sys-accent hover:underline whitespace-nowrap">
              <span className="sm:hidden">Групи</span>
              <span className="hidden sm:inline">Усі групи</span>
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
          </nav>
        </div>
      </footer>

      {scheduleDays.length > 0 && (
        <noscript>
          <section style={{ maxWidth: "800px", margin: "16px auto", padding: "0 16px" }}>
            <h2>Розклад пар групи {group?.name || rawCode} на тиждень</h2>
            {scheduleDays.map((day, idx) => (
              <div key={day.date || idx}>
                <h3>{getDayTitle(day.date)}</h3>
                {day.lessons && day.lessons.length > 0 ? (
                  <ul>
                    {day.lessons.map((lesson, lIdx) => (
                      <li key={lesson.id || lIdx}>
                        <strong>{lesson.lesson_number} пара ({lesson.time}):</strong>{" "}
                        {lesson.subject_name || lesson.subject || "Заняття"} —{" "}
                        {lesson.teacher_name || lesson.teacher || "Викладач"}
                        {lesson.room ? `, ауд. ${lesson.room}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Занять немає.</p>
                )}
              </div>
            ))}
          </section>
        </noscript>
      )}
    </div>
  );
}
