import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SchedulePageClient } from "../../../components/SchedulePageClient";
import { SITE_URL } from "../../../lib/site";
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
      `розклад групи ${group.name}`,
      `розклад ${group.name} дфкр`,
      `розклад групи ${group.name} дфкр`,
      `розклад групи ${group.name} дніпровського фахового коледжу радіоелектроніки`,
      `група ${group.name} кре`,
      `розклад занять ${fullCode}`,
      `дфкр ${course ? `${course} курс` : ""} ${specialty}`,
      "розклад дніпровського фахового коледжу радіоелектроніки",
      "дніпровський фаховий коледж радіоелектроніки розклад",
      "розклад дфкр",
      "розклад кре",
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
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
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

  const groupId = group?.id;
  const scheduleDays = groupId
    ? await fetchScheduleWeekForSsr({ groupId })
    : [];

  const fullCode = group ? getGroupFullCode(group) : rawCode;
  const course = group ? getGroupCourse(group.name) : null;
  const specialty = group ? getGroupSpecialtyName(group.faculty_id) : "";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Course",
        name: `Розклад занять групи ${group?.name || rawCode} (${fullCode})`,
        description: `Розклад навчальних занять групи ${group?.name || rawCode} Дніпровського фахового коледжу радіоелектроніки. Спеціальність: ${specialty}.`,
        provider: {
          "@type": "CollegeOrUniversity",
          name: "Дніпровський фаховий коледж радіоелектроніки",
          sameAs: "https://kre.dp.ua/",
        },
        educationalCredentialAwarded: "Фаховий молодший бакалавр",
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
            name: "Розклад груп",
            item: `${SITE_URL}/#groups`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: `Група ${group?.name || rawCode}`,
            item: `${SITE_URL}/group/${encodeURIComponent(group?.name || rawCode)}`,
          },
        ],
      },
    ],
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-dvh bg-transparent text-sys-text-primary outline-none"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section
        aria-label={`Розклад занять групи ${group?.name || rawCode} ДФКР`}
        className="sr-only"
      >
        <h1>
          Розклад групи {group?.name || rawCode} ДФКР — {fullCode}
        </h1>
        <p>
          Актуальний розклад занять для студентів групи {group?.name || rawCode}{" "}
          ({fullCode}), {course ? `${course} курс, ` : ""}спеціальність &ldquo;{specialty}&rdquo; у Дніпровському фаховому коледжі радіоелектроніки (ДФКР / КРЕ).
        </p>
        <p>
          Розклад дзвінків: 1 пара 09:00–10:20, 2 пара 10:40–12:00, 3 пара 12:30–13:50, 4 пара 14:00–15:20.
        </p>

        {scheduleDays.length > 0 && (
          <div>
            <h2>Розклад пар на поточний навчальний тиждень</h2>
            {scheduleDays.map((day, idx) => (
              <div key={day.date || idx}>
                <h3>{getDayTitle(day.date)}</h3>
                {day.lessons && day.lessons.length > 0 ? (
                  <ul>
                    {day.lessons.map((lesson, lIdx) => (
                      <li key={lesson.id || lIdx}>
                        <strong>{lesson.lesson_number} пара ({lesson.time}):</strong>{" "}
                        {lesson.subject_name || lesson.subject || "Заняття"} —{" "}
                        викладач {lesson.teacher_name || lesson.teacher || "Викладач"}
                        {lesson.room ? `, ауд. ${lesson.room}` : ""}
                        {lesson.week_type === "numerator" ? " (чисельник)" : ""}
                        {lesson.week_type === "denominator" ? " (знаменник)" : ""}
                        {lesson.second_teacher_id ? " (пара з 2 викладачами / підгрупами)" : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Занять немає (самостійна робота / вихідний).</p>
                )}
              </div>
            ))}
          </div>
        )}

        <nav aria-label="Навігація за іншими групами ДФКР">
          <h2>Інші групи коледжу радіоелектроніки</h2>
          <ul>
            {groups.map((g) => (
              <li key={g.id}>
                <a href={`/group/${encodeURIComponent(g.name)}`}>
                  Розклад групи {g.name}
                </a>
              </li>
            ))}
          </ul>
          <p>
            <a href="/bells">Розклад дзвінків ДФКР</a> |{" "}
            <a href="/educational-process">Графік освітнього процесу</a> |{" "}
            <a href="/statistics">Статистика пар</a>
          </p>
        </nav>
      </section>

      <SchedulePageClient
        initialGroups={groups}
        initialTeachers={teachers}
        initialGroupId={groupId}
        initialMode="student"
      />
    </main>
  );
}
