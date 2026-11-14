import type { Metadata } from "next";
import { AtlasClient } from "@/components/atlas/AtlasClient";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Атлас ДФКР — Інтерактивна мапа зв'язків",
  description:
    "Інтерактивна орбітальна мапа зв'язків ДФКР (КРЕ): досліджуйте групи, викладачів, предмети, аудиторії, кураторство та перетини між будь-якими двома вузлами розкладу.",
  alternates: {
    canonical: "/atlas",
  },
  openGraph: {
    title: "Атлас ДФКР — Інтерактивна мапа зв'язків | Розклад ДФКР",
    description:
      "Досліджуйте зв'язки між групами, викладачами, предметами та аудиторіями Дніпровського фахового коледжу радіоелектроніки.",
    url: `${SITE_URL}/atlas`,
    type: "website",
    locale: "uk_UA",
  },
  twitter: {
    card: "summary_large_image",
    title: "Атлас ДФКР — Інтерактивна мапа зв'язків",
    description:
      "Інтерактивний граф груп, викладачів, предметів та аудиторій Дніпровського фахового коледжу радіоелектроніки.",
  },
};

export default function AtlasPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/atlas#webpage`,
        url: `${SITE_URL}/atlas`,
        name: "Атлас ДФКР — Інтерактивна мапа зв'язків",
        description:
          "Інтерактивна орбітальна мапа зв'язків груп, викладачів, предметів та аудиторій ДФКР.",
        inLanguage: "uk-UA",
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Розклад ДФКР",
            item: SITE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Атлас ДФКР",
            item: `${SITE_URL}/atlas`,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <AtlasClient />
    </>
  );
}
