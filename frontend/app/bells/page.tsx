import type { Metadata } from "next";
import { BellsLiveView } from "@/components/bells/BellsLiveView";
import { TransitionLink } from "@/components/navigation/NavigationTransitionProvider";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import {
  BarChartIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClockIcon,
} from "@/components/ui/Icons";
import type { PublicBellsResponse } from "@/lib/api";
import { SITE_URL } from "@/lib/site";
import { fetchBellsForSsr } from "@/lib/ssrApi";

export const metadata: Metadata = {
  title: "Розклад дзвінків ДФКР — час пар коледжу радіоелектроніки",
  description:
    "Актуальний розклад дзвінків Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ): стандартні пари по 80 хв, скорочені дні по 50 хв, велика перерва та поточний статус пари.",
  keywords: [
    "розклад дзвінків дфкр",
    "розклад дзвінків кре",
    "розклад дзвінків дніпровського фахового коледжу радіоелектроніки",
    "час пар дфкр",
    "тривалість пар дфкр",
    "велика перерва дфкр",
    "скорочені дні дфкр",
    "дзвінки коледж радіоелектроніки",
  ],
  alternates: {
    canonical: `${SITE_URL}/bells`,
  },
  openGraph: {
    title: "Розклад дзвінків ДФКР — стандартні та скорочені дні",
    description:
      "Розклад дзвінків навчальних пар коледжу радіоелектроніки: 1–5 пари, велика перерва 30 хв, скорочені дні по 50 хв.",
    url: `${SITE_URL}/bells`,
    type: "website",
    locale: "uk_UA",
    siteName: "Розклад ДФКР",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Розклад дзвінків ДФКР",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Розклад дзвінків ДФКР — коледж радіоелектроніки",
    description:
      "Розклад дзвінків та тривалість пар Дніпровського фахового коледжу радіоелектроніки.",
    images: ["/og-image.png"],
  },
};

const FALLBACK_BELLS: PublicBellsResponse = {
  standard: [
    { lesson_number: 1, start_time: "09:00", end_time: "10:20", duration_minutes: 80, break_after_minutes: 20, is_optional: false },
    { lesson_number: 2, start_time: "10:40", end_time: "12:00", duration_minutes: 80, break_after_minutes: 30, is_optional: false },
    { lesson_number: 3, start_time: "12:30", end_time: "13:50", duration_minutes: 80, break_after_minutes: 10, is_optional: false },
    { lesson_number: 4, start_time: "14:00", end_time: "15:20", duration_minutes: 80, break_after_minutes: 10, is_optional: false },
    { lesson_number: 5, start_time: "15:30", end_time: "16:50", duration_minutes: 80, break_after_minutes: null, is_optional: true },
  ],
  shortened: [
    { lesson_number: 1, start_time: "09:00", end_time: "09:50", duration_minutes: 50, break_after_minutes: 10, is_optional: false },
    { lesson_number: 2, start_time: "10:00", end_time: "10:50", duration_minutes: 50, break_after_minutes: 10, is_optional: false },
    { lesson_number: 3, start_time: "11:00", end_time: "11:50", duration_minutes: 50, break_after_minutes: 10, is_optional: false },
    { lesson_number: 4, start_time: "12:00", end_time: "12:50", duration_minutes: 50, break_after_minutes: 10, is_optional: false },
    { lesson_number: 5, start_time: "13:00", end_time: "13:50", duration_minutes: 50, break_after_minutes: null, is_optional: true },
  ],
  today_date: "",
  is_shortened_today: false,
  today_reason: null,
  upcoming_shortened_days: [],
};

const FAQS = [
  {
    q: "Скільки триває академічна пара в ДФКР?",
    a: "Стандартна навчальна пара триває 80 хвилин (1 година 20 хвилин). У скорочені дні тривалість кожної пари становить 50 хвилин.",
  },
  {
    q: "О котрій годині починається перша пара?",
    a: "Перша пара в коледжі завжди розпочинається о 09:00 як у звичайні, так і у скорочені навчальні дні.",
  },
  {
    q: "Коли велика перерва у коледжі радіоелектроніки?",
    a: "Велика перерва триває 30 хвилин між 2-ю та 3-ю парами — з 12:00 до 12:30.",
  },
  {
    q: "Який розклад дзвінків у скорочені дні (50 хв)?",
    a: "У скорочені дні пари тривають по 50 хвилин з перервами по 10 хвилин: 1 пара 09:00–09:50, 2 пара 10:00–10:50, 3 пара 11:00–11:50, 4 пара 12:00–12:50, 5 пара 13:00–13:50.",
  },
  {
    q: "Чи діють скорочені дні автоматично у розкладі на сайті?",
    a: "Так. Коли адміністрація коледжу позначає дату як скорочений день, час пар у головному розкладі та статус на цій сторінці оновлюються автоматично.",
  },
];

export default async function BellsPage() {
  const ssrData = await fetchBellsForSsr();
  const initialData = ssrData ?? FALLBACK_BELLS;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/bells#webpage`,
        url: `${SITE_URL}/bells`,
        name: "Розклад дзвінків ДФКР — час пар коледжу радіоелектроніки",
        inLanguage: "uk-UA",
        isPartOf: { "@id": `${SITE_URL}/#website` },
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
            name: "Розклад дзвінків",
            item: `${SITE_URL}/bells`,
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.a,
          },
        })),
      },
    ],
  };

  return (
    <div className="min-h-dvh bg-sys-bg text-sys-text-primary pb-20 md:pb-12">
      <SubpageHeader
        title="Розклад дзвінків ДФКР"
        subtitle="Дніпровський фаховий коледж радіоелектроніки"
        maxWidthClass="max-w-4xl"
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="vt-main-content pt-6 outline-none"
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <nav aria-label="Хлібні крихти" className="mb-5 text-xs text-sys-text-secondary">
            <ol className="flex items-center gap-1.5">
              <li>
                <TransitionLink href="/" className="hover:text-sys-accent hover:underline">
                  Головна
                </TransitionLink>
              </li>
              <li aria-hidden="true">/</li>
              <li className="font-medium text-sys-text-primary" aria-current="page">
                Розклад дзвінків
              </li>
            </ol>
          </nav>

          <BellsLiveView initialData={initialData} />

          {/* Блок FAQ */}
          <section aria-labelledby="heading-faqs" className="mt-10">
            <h2
              id="heading-faqs"
              className="mb-4 text-lg font-bold text-sys-text-primary sm:text-xl"
            >
              Часті запитання
            </h2>
            <div className="space-y-3">
              {FAQS.map((faq, idx) => (
                <details
                  key={idx}
                  className="scroll-reveal-card group rounded-xl border border-sys-border bg-sys-card p-4 transition-colors hover:border-sys-accent/40 open:border-sys-accent/60"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-sys-text-primary [&::-webkit-details-marker]:hidden">
                    <span>{faq.q}</span>
                    <ChevronDownIcon className="h-4 w-4 shrink-0 text-sys-text-secondary transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-sys-text-secondary">
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </section>

          {/* Швидкі посилання */}
          <section
            aria-labelledby="heading-quick-links"
            className="mt-10 rounded-2xl border border-sys-border bg-sys-card/70 p-5 sm:p-6"
          >
            <h2 id="heading-quick-links" className="text-base font-semibold text-sys-text-primary">
              Інші розділи розкладу
            </h2>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <TransitionLink
                href="/"
                className="spring-press inline-flex items-center gap-2 rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 font-medium transition-colors hover:border-sys-accent/40 hover:text-sys-accent"
              >
                <CalendarIcon className="h-4 w-4 text-sys-text-secondary" />
                <span>Розклад занять</span>
              </TransitionLink>
              <TransitionLink
                href="/educational-process"
                className="spring-press inline-flex items-center gap-2 rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 font-medium transition-colors hover:border-sys-accent/40 hover:text-sys-accent"
              >
                <ClockIcon className="h-4 w-4 text-sys-text-secondary" />
                <span>Графік освітнього процесу</span>
              </TransitionLink>
              <TransitionLink
                href="/statistics"
                className="spring-press inline-flex items-center gap-2 rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 font-medium transition-colors hover:border-sys-accent/40 hover:text-sys-accent"
              >
                <BarChartIcon className="h-4 w-4 text-sys-text-secondary" />
                <span>Статистика навантаження</span>
              </TransitionLink>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
