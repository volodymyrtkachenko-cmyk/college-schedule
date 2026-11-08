import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Графік освітнього процесу ДФКР (КРЕ)",
  description: "Календарний графік освітнього процесу Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ): навчальні семестри, екзаменаційні сесії, навчальні та виробничі практики, канікули.",
  keywords: [
    "графік освітнього процесу дфкр",
    "графік навчального процесу дфкр",
    "сесія дфкр",
    "канікули дфкр",
    "практика дфкр",
    "семестри дфкр",
    "навчальний графік кре",
    "розклад дфкр",
    "розклад кре",
  ],
  alternates: {
    canonical: "/educational-process",
  },
  openGraph: {
    title: "Графік освітнього процесу | Розклад ДФКР (КРЕ)",
    description: "Календарний графік освітнього процесу ДФКР (КРЕ): семестри, екзаменаційні сесії, виробничі практики та канікули.",
    url: "/educational-process",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Графік освітнього процесу | Розклад ДФКР (КРЕ)",
    description: "Календарний графік освітнього процесу ДФКР (КРЕ): семестри, екзаменаційні сесії, практики та канікули.",
    images: ["/og-image.png"],
  },
};

export default function EducationalProcessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
