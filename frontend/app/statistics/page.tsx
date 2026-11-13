import { StatisticsClient } from "@/components/statistics/StatisticsClient";
import { SITE_URL } from "@/lib/site";

export default function StatisticsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/statistics#webpage`,
        url: `${SITE_URL}/statistics`,
        name: "Статистика занять та навантаження ДФКР",
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
            name: "Статистика занять",
            item: `${SITE_URL}/statistics`,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <StatisticsClient />
    </>
  );
}
