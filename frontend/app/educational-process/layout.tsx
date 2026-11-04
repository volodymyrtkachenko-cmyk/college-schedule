import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Графік навчального процесу",
  description: "Календарний графік освітнього процесу ДФКР: семестри, екзаменаційні сесії, навчальні та виробничі практики, канікули.",
  alternates: {
    canonical: "/educational-process",
  },
  openGraph: {
    title: "Графік навчального процесу | ДФКР",
    description: "Календарний графік освітнього процесу ДФКР: семестри, екзаменаційні сесії, виробничі практики та канікули.",
    url: "/educational-process",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Графік навчального процесу | ДФКР",
    description: "Календарний графік освітнього процесу ДФКР: семестри, екзаменаційні сесії, практики та канікули.",
    images: ["/og-image.png"],
  },
};

export default function EducationalProcessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
