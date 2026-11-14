import type { Metadata } from "next";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import {
  BellIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  UserCheckIcon,
  UsersIcon,
} from "@/components/ui/Icons";
import {
  getGroupCourse,
  getGroupFullCode,
  getGroupSpecialtyName,
} from "@/lib/groupInfo";
import type { ReferenceRecord } from "@/lib/api";
import { SITE_URL } from "@/lib/site";
import { fetchDirectoryForSsr } from "@/lib/ssrApi";

export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Навчальні групи ДФКР — розклад занять за курсами",
  description:
    "Каталог навчальних груп Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ) за курсами та спеціальностями. Оберіть групу для перегляду розкладу пар і кабінетів.",
  keywords: [
    "групи дфкр",
    "розклад груп дфкр",
    "спеціальності дфкр",
    "розклад кре",
    "коледж радіоелектроніки групи",
  ],
  alternates: {
    canonical: `${SITE_URL}/groups`,
  },
  openGraph: {
    title: "Навчальні групи ДФКР | Розклад занять",
    description:
      "Усі навчальні групи Дніпровського фахового коледжу радіоелектроніки за курсами 1–4. Швидкий перехід до розкладу пар.",
    url: `${SITE_URL}/groups`,
    type: "website",
    locale: "uk_UA",
    siteName: "Розклад ДФКР",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Навчальні групи ДФКР",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Навчальні групи ДФКР — розклад занять",
    description:
      "Каталог навчальних груп Дніпровського фахового коледжу радіоелектроніки за курсами.",
    images: ["/og-image.png"],
  },
};

export default async function GroupsDirectoryPage() {
  const { groups } = await fetchDirectoryForSsr();

  const sorted = [...groups].sort((a, b) =>
    a.name.localeCompare(b.name, "uk", { numeric: true })
  );

  const buckets = new Map<string, ReferenceRecord[]>();
  const courseOrder = ["1 курс", "2 курс", "3 курс", "4 курс", "Інші групи"];
  for (const label of courseOrder) {
    buckets.set(label, []);
  }

  for (const group of sorted) {
    const course = getGroupCourse(group.name);
    const key = course ? `${course} курс` : "Інші групи";
    const list = buckets.get(key) ?? [];
    list.push(group);
    buckets.set(key, list);
  }

  const nonEmptySections = courseOrder
    .map((label) => ({ label, items: buckets.get(label) ?? [] }))
    .filter((section) => section.items.length > 0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/groups#webpage`,
        url: `${SITE_URL}/groups`,
        name: "Навчальні групи ДФКР",
        inLanguage: "uk-UA",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": "https://kre.dp.ua/#organization" },
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
        ],
      },
    ],
  };

  return (
    <div className="min-h-dvh bg-sys-bg text-sys-text-primary pb-20 md:pb-12">
      <SubpageHeader
        title="Навчальні групи ДФКР"
        subtitle="Дніпровський фаховий коледж радіоелектроніки"
        maxWidthClass="max-w-5xl"
      />

      <main id="main-content" tabIndex={-1} className="vt-main-content pt-6 outline-none">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        <div className="mx-auto max-w-5xl px-4 sm:px-6 space-y-6">
          <nav aria-label="Хлібні крихти" className="text-xs text-sys-text-secondary">
            <ol className="flex items-center gap-1.5">
              <li>
                <TransitionLink href="/" className="hover:text-sys-accent hover:underline">
                  Головна
                </TransitionLink>
              </li>
              <li aria-hidden="true">/</li>
              <li className="font-medium text-sys-text-primary" aria-current="page">
                Навчальні групи
              </li>
            </ol>
          </nav>

          <section className="rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg sm:text-xl font-bold text-sys-text-primary">
                  <GraduationCapIcon className="h-5 w-5 text-sys-accent" />
                  <span>Каталог академічних груп</span>
                </h2>
                <p className="mt-1 text-sm text-sys-text-secondary">
                  Оберіть свою групу для перегляду розкладу на сьогодні, тиждень, чисельник та знаменник.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <TransitionLink
                  href="/teachers"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-3 text-xs font-medium text-sys-text-secondary hover:border-sys-accent/45 hover:text-sys-text-primary transition-[color,border-color,background-color] duration-150"
                >
                  <UserCheckIcon className="h-3.5 w-3.5" />
                  <span>Викладачі</span>
                </TransitionLink>
                <TransitionLink
                  href="/bells"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-3 text-xs font-medium text-sys-text-secondary hover:border-sys-accent/45 hover:text-sys-text-primary transition-[color,border-color,background-color] duration-150"
                >
                  <BellIcon className="h-3.5 w-3.5" />
                  <span>Дзвінки</span>
                </TransitionLink>
              </div>
            </div>
          </section>

          {nonEmptySections.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card p-8 text-center text-sm text-sys-text-secondary">
              Список груп тимчасово недоступний. Спробуйте перейти на{" "}
              <TransitionLink href="/" className="text-sys-accent underline">
                головну сторінку розкладу
              </TransitionLink>
              .
            </div>
          ) : (
            <div className="space-y-6">
              {nonEmptySections.map(({ label, items }) => (
                <section
                  key={label}
                  aria-labelledby={`course-${label}`}
                  className="rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6"
                >
                  <div className="mb-4 flex items-center justify-between gap-3 border-b border-sys-border/70 pb-3">
                    <h3
                      id={`course-${label}`}
                      className="flex items-center gap-2 text-base font-bold text-sys-text-primary"
                    >
                      <UsersIcon className="h-4 w-4 text-sys-accent" />
                      <span>{label}</span>
                    </h3>
                    <span className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-0.5 text-xs font-medium text-sys-text-secondary">
                      {items.length} гр.
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((group) => {
                      const fullCode = getGroupFullCode(group);
                      const specialty = getGroupSpecialtyName(group.faculty_id);
                      return (
                        <TransitionLink
                          key={group.id}
                          href={`/group/${encodeURIComponent(group.name)}`}
                          className="group flex items-center justify-between gap-3 rounded-xl border border-sys-border bg-sys-bg px-3.5 py-3 hover:border-sys-accent/50 hover:bg-sys-card transition-[color,border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-sys-text-primary group-hover:text-sys-accent transition-colors">
                                Група {group.name}
                              </span>
                              {fullCode !== group.name && (
                                <span className="truncate rounded-md border border-sys-border bg-sys-card px-1.5 py-0.5 text-[11px] font-medium text-sys-text-secondary">
                                  {fullCode}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 line-clamp-2 leading-snug break-words text-xs text-sys-text-secondary">
                              {specialty}
                            </p>
                          </div>
                          <ChevronRightIcon className="h-4 w-4 shrink-0 text-sys-text-muted group-hover:text-sys-accent transition-colors" />
                        </TransitionLink>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
