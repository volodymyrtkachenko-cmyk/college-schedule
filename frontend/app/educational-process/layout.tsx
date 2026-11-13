import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Графік освітнього процесу ДФКР",
  description:
    "Календарний графік освітнього процесу Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ): навчальні семестри, екзаменаційні сесії, практики та канікули.",
  keywords: [
    "графік освітнього процесу дфкр",
    "графік навчального процесу дфкр",
    "сесія дфкр",
    "канікули дфкр",
    "практика дфкр",
    "семестри дфкр",
    "навчальний графік кре",
  ],
  alternates: {
    canonical: `${SITE_URL}/educational-process`,
  },
  openGraph: {
    title: "Графік освітнього процесу | Розклад ДФКР",
    description:
      "Календарний графік освітнього процесу ДФКР: семестри, екзаменаційні сесії, виробничі практики та канікули.",
    url: `${SITE_URL}/educational-process`,
    type: "website",
    locale: "uk_UA",
    siteName: "Розклад ДФКР",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Графік освітнього процесу | Розклад ДФКР",
    description:
      "Календарний графік освітнього процесу ДФКР: екзаменаційні сесії, практики та канікули.",
    images: ["/og-image.png"],
  },
};

export default function EducationalProcessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
