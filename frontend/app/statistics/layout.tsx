import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Статистика занять",
  description: "Аналітика та статистика занять ДФКР: навчальне навантаження викладачів, розподіл аудиторій та виконані навчальні години.",
  alternates: {
    canonical: "/statistics",
  },
  openGraph: {
    title: "Статистика занять | ДФКР",
    description: "Аналітика та статистика занять ДФКР: навчальне навантаження викладачів, розподіл аудиторій та навчальні години.",
    url: "/statistics",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Статистика занять | ДФКР",
    description: "Аналітика та статистика занять ДФКР: навчальне навантаження викладачів та аудиторії.",
    images: ["/og-image.png"],
  },
};

export default function StatisticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
