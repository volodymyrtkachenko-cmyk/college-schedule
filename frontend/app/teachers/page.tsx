import type { Metadata } from "next";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import {
  BellIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  UserCheckIcon,
} from "@/components/ui/Icons";
import type { ReferenceRecord } from "@/lib/api";
import { SITE_URL } from "@/lib/site";
import { toTeacherSlug } from "@/lib/slug";
import { fetchDirectoryForSsr } from "@/lib/ssrApi";

export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Викладачі ДФКР — розклад занять коледжу радіоелектроніки",
  description:
    "Довідник викладачів Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ). Оберіть викладача для перегляду актуального розкладу пар, аудиторій і груп.",
  keywords: [
    "викладачі дфкр",
    "розклад викладачів дфкр",
    "викладачі кре",
    "розклад пар викладачів",
    "коледж радіоелектроніки викладачі",
  ],
  alternates: {
    canonical: `${SITE_URL}/teachers`,
  },
  openGraph: {
    title: "Викладачі ДФКР | Розклад занять",
    description:
      "Список викладачів Дніпровського фахового коледжу радіоелектроніки з прямим переходом до актуального тижневого розкладу.",
    url: `${SITE_URL}/teachers`,
    type: "website",
    locale: "uk_UA",
    siteName: "Розклад ДФКР",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Викладачі ДФКР",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Викладачі ДФКР — розклад занять",
    description:
      "Довідник викладачів Дніпровського фахового коледжу радіоелектроніки.",
    images: ["/og-image.png"],
  },
};

export default async function TeachersDirectoryPage() {
  const { teachers } = await fetchDirectoryForSsr();

  const sorted = [...teachers].sort((a, b) => a.name.localeCompare(b.name, "uk"));
  const letterGroups = new Map<string, ReferenceRecord[]>();

  for (const teacher of sorted) {
    const firstChar = teacher.name.trim().charAt(0).toUpperCase() || "#";
    const list = letterGroups.get(firstChar) ?? [];
    list.push(teacher);
    letterGroups.set(firstChar, list);
  }

  const letters = Array.from(letterGroups.keys()).sort((a, b) => a.localeCompare(b, "uk"));

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/teachers#webpage`,
        url: `${SITE_URL}/teachers`,
        name: "Викладачі ДФКР",
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
            name: "Викладачі ДФКР",
            item: `${SITE_URL}/teachers`,
          },
        ],
      },
    ],
  };

  return (
    <div className="min-h-dvh bg-sys-bg text-sys-text-primary pb-20 md:pb-12">
      <SubpageHeader
        title="Викладачі ДФКР"
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
                Викладачі
              </li>
            </ol>
          </nav>

          <section className="rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg sm:text-xl font-bold text-sys-text-primary">
                  <UserCheckIcon className="h-5 w-5 text-sys-accent" />
                  <span>Алфавітний довідник викладачів</span>
                </h2>
                <p className="mt-1 text-sm text-sys-text-secondary">
                  Актуальний розклад пар, груп та аудиторій для {sorted.length} викладачів коледжу.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <TransitionLink
                  href="/groups"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sys-border bg-sys-bg px-3 text-xs font-medium text-sys-text-secondary hover:border-sys-accent/45 hover:text-sys-text-primary transition-[color,border-color,background-color] duration-150"
                >
                  <GraduationCapIcon className="h-3.5 w-3.5" />
                  <span>Групи</span>
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

            {letters.length > 0 && (
              <nav aria-label="Алфавітна навігація" className="mt-4 flex flex-wrap gap-1.5 pt-4 border-t border-sys-border/70">
                {letters.map((letter) => (
                  <a
                    key={letter}
                    href={`#letter-${encodeURIComponent(letter)}`}
                    className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg border border-sys-border bg-sys-bg px-2 text-xs font-semibold text-sys-text-secondary hover:border-sys-accent/50 hover:text-sys-accent transition-[color,border-color] duration-150"
                  >
                    {letter}
                  </a>
                ))}
              </nav>
            )}
          </section>

          {letters.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-sys-border bg-sys-card p-8 text-center text-sm text-sys-text-secondary">
              Список викладачів тимчасово недоступний. Спробуйте перейти на{" "}
              <TransitionLink href="/" className="text-sys-accent underline">
                головну сторінку розкладу
              </TransitionLink>
              .
            </div>
          ) : (
            <div className="space-y-5">
              {letters.map((letter) => {
                const list = letterGroups.get(letter) ?? [];
                return (
                  <section
                    key={letter}
                    id={`letter-${encodeURIComponent(letter)}`}
                    aria-labelledby={`heading-${letter}`}
                    className="rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6 scroll-mt-20"
                  >
                    <h3
                      id={`heading-${letter}`}
                      className="mb-3 border-b border-sys-border/70 pb-2 text-base font-bold text-sys-accent"
                    >
                      {letter}
                    </h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {list.map((teacher) => (
                        <TransitionLink
                          key={teacher.id}
                          href={`/teacher/${toTeacherSlug(teacher.name)}`}
                          className="group flex items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-bg px-3.5 py-2.5 hover:border-sys-accent/50 hover:bg-sys-card transition-[color,border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
                        >
                          <span className="break-words leading-snug text-sm font-medium text-sys-text-primary group-hover:text-sys-accent transition-colors">
                            {teacher.name}
                          </span>
                          <ChevronRightIcon className="h-4 w-4 shrink-0 text-sys-text-muted group-hover:text-sys-accent transition-colors" />
                        </TransitionLink>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
