import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Статистика занять та навантаження ДФКР",
  description:
    "Аналітика та статистика занять Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ): виконання навчального плану, навантаження викладачів та розподіл за дисциплінами.",
  keywords: [
    "статистика занять дфкр",
    "навантаження викладачів дфкр",
    "навчальний план дфкр",
    "години занять дфкр",
    "статистика кре",
  ],
  alternates: {
    canonical: `${SITE_URL}/statistics`,
  },
  openGraph: {
    title: "Статистика занять та навантаження | Розклад ДФКР",
    description:
      "Аналітика та статистика занять ДФКР: виконання навчального плану, години за предметами та навантаження викладачів.",
    url: `${SITE_URL}/statistics`,
    type: "website",
    locale: "uk_UA",
    siteName: "Розклад ДФКР",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Статистика занять та навантаження | Розклад ДФКР",
    description:
      "Аналітика та статистика занять ДФКР: навчальне навантаження викладачів та виконання плану груп.",
    images: ["/og-image.png"],
  },
};

export default function StatisticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
