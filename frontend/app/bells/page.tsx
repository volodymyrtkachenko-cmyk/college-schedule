import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "../../lib/site";

export const metadata: Metadata = {
  title: "Розклад дзвінків ДФКР — розклад дзвінків пар коледжу радіоелектроніки",
  description:
    "Актуальний розклад дзвінків Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ): стандартні пари по 80 хв, скорочені дні по 50 хв, велика перерва та розклад занять.",
  keywords: [
    "розклад дзвінків дфкр",
    "розклад дзвінків кре",
    "розклад дзвінків дніпровського фахового коледжу радіоелектроніки",
    "розклад дзвінків дніпровського коледжу радіоелектроніки",
    "розклад дзвінків коледжу радіоелектроніки",
    "дніпровський фаховий коледж радіоелектроніки розклад дзвінків",
    "дзвінки дфкр",
    "час пар дфкр",
    "тривалість пар дфкр",
    "велика перерва дфкр",
    "скорочені дні дфкр",
    "дзвінки коледж радіоелектроніки",
    "розклад пар дфкр",
    "розклад дфкр",
    "розклад кре",
    "расписание звонков дфкр",
    "расписание звонков днепровского колледжа радиоэлектроники",
  ],
  alternates: {
    canonical: `${SITE_URL}/bells`,
  },
  openGraph: {
    title: "Розклад дзвінків ДФКР (КРЕ) — стандартні та скорочені дні",
    description:
      "Розклад дзвінків навчальних пар коледжу радіоелектроніки: 1–4 пари, велика перерва 30 хв, розклад скорочених днів.",
    url: `${SITE_URL}/bells`,
    type: "website",
    locale: "uk_UA",
    siteName: "Розклад ДФКР",
  },
  twitter: {
    card: "summary",
    title: "Розклад дзвінків ДФКР — коледж радіоелектроніки",
    description:
      "Розклад дзвінків та тривалість пар коледжу радіоелектроніки (ДФКР / КРЕ).",
  },
};

const STANDARD_BELLS = [
  { pair: 1, start: "09:00", end: "10:20", breakAfter: "20 хв" },
  { pair: 2, start: "10:40", end: "12:00", breakAfter: "30 хв (велика перерва)" },
  { pair: 3, start: "12:30", end: "13:50", breakAfter: "10 хв" },
  { pair: 4, start: "14:00", end: "15:20", breakAfter: "10 хв" },
  { pair: 5, start: "15:30", end: "16:50", breakAfter: "—" },
];

const SHORT_BELLS = [
  { pair: 1, start: "09:00", end: "09:50", breakAfter: "10 хв" },
  { pair: 2, start: "10:00", end: "10:50", breakAfter: "10 хв" },
  { pair: 3, start: "11:00", end: "11:50", breakAfter: "10 хв" },
  { pair: 4, start: "12:00", end: "12:50", breakAfter: "10 хв" },
  { pair: 5, start: "13:00", end: "13:50", breakAfter: "—" },
];

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
    q: "Расписание звонков ДФКР (КРЭ Днепр)?",
    a: "Стандартное расписание звонков ДФКР включает пары по 80 минут: 1 пара (09:00–10:20), 2 пара (10:40–12:00), 3 пара (12:30–13:50), 4 пара (14:00–15:20). Большая перемена — 30 минут (12:00–12:30).",
  },
];

export default function BellsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
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
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-dvh bg-sys-bg pb-20 pt-6 text-sys-text-primary outline-none md:pb-12"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {/* Хлібні крихти та навігація */}
        <nav aria-label="Хлібні крихти" className="mb-4 text-xs text-sys-text-secondary">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-sys-accent hover:underline">
                Головна
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-sys-text-primary" aria-current="page">
              Розклад дзвінків
            </li>
          </ol>
        </nav>

        {/* Заголовок сторінки */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-sys-text-primary sm:text-3xl">
              Розклад дзвінків ДФКР
            </h1>
            <p className="mt-1 text-sm text-sys-text-secondary sm:text-base">
              Дніпровський фаховий коледж радіоелектроніки (КРЕ / ДКРЕ)
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sys-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-sys-accent focus:ring-offset-2"
          >
            ← До розкладу пар
          </Link>
        </div>

        {/* Таблиці розкладу дзвінків */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Стандартний розклад */}
          <section
            aria-labelledby="heading-standard-bells"
            className="rounded-2xl border border-sys-border bg-sys-card p-5 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2
                id="heading-standard-bells"
                className="text-lg font-bold text-sys-text-primary"
              >
                🔔 Стандартні дні
              </h2>
              <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                80 хв пара
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-sys-border text-xs text-sys-text-secondary">
                    <th className="pb-2 font-medium">Пара</th>
                    <th className="pb-2 font-medium">Час</th>
                    <th className="pb-2 font-medium">Перерва</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sys-border/50">
                  {STANDARD_BELLS.map((b) => (
                    <tr key={b.pair} className="hover:bg-sys-hover/50">
                      <td className="py-2.5 font-semibold text-sys-text-primary">
                        {b.pair} пара
                      </td>
                      <td className="py-2.5 font-mono text-sys-text-primary">
                        {b.start} – {b.end}
                      </td>
                      <td className="py-2.5 text-xs text-sys-text-secondary">
                        {b.breakAfter}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-sys-text-secondary">
              * 5-та пара призначається факультативно або за індивідуальним розкладом.
            </p>
          </section>

          {/* Скорочений розклад */}
          <section
            aria-labelledby="heading-short-bells"
            className="rounded-2xl border border-sys-border bg-sys-card p-5 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2
                id="heading-short-bells"
                className="text-lg font-bold text-sys-text-primary"
              >
                ⏱️ Скорочені дні
              </h2>
              <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                50 хв пара
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-sys-border text-xs text-sys-text-secondary">
                    <th className="pb-2 font-medium">Пара</th>
                    <th className="pb-2 font-medium">Час</th>
                    <th className="pb-2 font-medium">Перерва</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sys-border/50">
                  {SHORT_BELLS.map((b) => (
                    <tr key={b.pair} className="hover:bg-sys-hover/50">
                      <td className="py-2.5 font-semibold text-sys-text-primary">
                        {b.pair} пара
                      </td>
                      <td className="py-2.5 font-mono text-sys-text-primary">
                        {b.start} – {b.end}
                      </td>
                      <td className="py-2.5 text-xs text-sys-text-secondary">
                        {b.breakAfter}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-sys-text-secondary">
              Застосовується у передсвяткові дні та дні педагогічних нарад за окремим розпорядженням адміністрації.
            </p>
          </section>
        </div>

        {/* Блок FAQ */}
        <section aria-labelledby="heading-faqs" className="mt-10">
          <h2
            id="heading-faqs"
            className="mb-4 text-xl font-bold text-sys-text-primary"
          >
            Часті запитання (FAQ)
          </h2>
          <div className="space-y-3">
            {FAQS.map((faq, idx) => (
              <details
                key={idx}
                className="group rounded-xl border border-sys-border bg-sys-card p-4 transition-colors hover:border-sys-accent/40 open:border-sys-accent/60"
              >
                <summary className="flex cursor-pointer items-center justify-between font-medium text-sys-text-primary">
                  <span>{faq.q}</span>
                  <span className="ml-2 text-sys-text-secondary transition-transform group-open:rotate-180">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-sys-text-secondary">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Швидкі посилання */}
        <section aria-labelledby="heading-quick-links" className="mt-10 rounded-2xl border border-sys-border bg-sys-card/50 p-6">
          <h2 id="heading-quick-links" className="text-base font-semibold text-sys-text-primary">
            Корисні розділи розкладу
          </h2>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Link
              href="/"
              className="rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 font-medium hover:text-sys-accent"
            >
              📅 Розклад занять на сьогодні та тиждень
            </Link>
            <Link
              href="/educational-process"
              className="rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 font-medium hover:text-sys-accent"
            >
              📆 Графік освітнього процесу
            </Link>
            <Link
              href="/statistics"
              className="rounded-lg border border-sys-border bg-sys-card px-3 py-1.5 font-medium hover:text-sys-accent"
            >
              📊 Статистика навантаження
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
