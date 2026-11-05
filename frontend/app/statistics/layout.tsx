import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Статистика занять та навантаження ДФКР (КРЕ)",
  description: "Аналітика та статистика занять Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ): навчальне навантаження викладачів, розподіл аудиторій та виконані години.",
  alternates: {
    canonical: "/statistics",
  },
  openGraph: {
    title: "Статистика занять та навантаження | Розклад ДФКР (КРЕ)",
    description: "Аналітика та статистика занять ДФКР (КРЕ): навчальне навантаження викладачів, розподіл аудиторій та навчальні години.",
    url: "/statistics",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Статистика занять та навантаження | Розклад ДФКР (КРЕ)",
    description: "Аналітика та статистика занять ДФКР (КРЕ): навчальне навантаження викладачів та аудиторії.",
    images: ["/og-image.png"],
  },
};

export default function StatisticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
