import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SchedulePageClient } from "../../../components/SchedulePageClient";
import { SITE_URL } from "../../../lib/site";
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
      `${teacher.name} кре`,
      "викладачі дфкр",
      "розклад викладачів дфкр",
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

  const teacherId = teacher?.id;
  const scheduleDays = teacherId
    ? await fetchScheduleWeekForSsr({ teacherId })
    : [];
  const teacherName = teacher?.name || rawSlug;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        name: teacherName,
        jobTitle: "Викладач",
        worksFor: {
          "@type": "CollegeOrUniversity",
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
            item: `${SITE_URL}/#teachers`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: teacherName,
            item: `${SITE_URL}/teacher/${toTeacherSlug(teacherName)}`,
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
        aria-label={`Розклад занять викладача ${teacherName} ДФКР`}
        className="sr-only"
      >
        <h1>
          Розклад викладача {teacherName} — Дніпровський фаховий коледж радіоелектроніки (ДФКР)
        </h1>
        <p>
          Актуальний тижневий розклад навчальних пар для викладача {teacherName} у коледжі радіоелектроніки (ДФКР / КРЕ / ДКРЕ, kre.dp.ua).
          Аудиторії, групи, чисельник і знаменник, дзвінки та заміна занять.
        </p>

        {scheduleDays.length > 0 && (
          <div>
            <h2>Розклад занять на тиждень</h2>
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
                        {lesson.week_type === "numerator" ? " (чисельник)" : ""}
                        {lesson.week_type === "denominator" ? " (знаменник)" : ""}
                        {lesson.second_teacher_id ? " (пара з 2 викладачами / підгрупами)" : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Цього дня пар за розкладом немає.</p>
                )}
              </div>
            ))}
          </div>
        )}

        <nav aria-label="Навігація за іншими викладачами ДФКР">
          <h2>Інші викладачі коледжу радіоелектроніки</h2>
          <ul>
            {teachers.map((t) => (
              <li key={t.id}>
                <a href={`/teacher/${toTeacherSlug(t.name)}`}>
                  Розклад викладача {t.name}
                </a>
              </li>
            ))}
          </ul>
          <p>
            <a href="/bells">Розклад дзвінків ДФКР</a> |{" "}
            <a href="/educational-process">Графік освітнього процесу</a> |{" "}
            <a href="/statistics">Статистика занять</a>
          </p>
        </nav>
      </section>

      <SchedulePageClient
        initialGroups={groups}
        initialTeachers={teachers}
        initialTeacherId={teacherId}
        initialMode="teacher"
      />
    </main>
  );
}
