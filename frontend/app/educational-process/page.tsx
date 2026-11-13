import { EducationalProcessClient } from "@/components/educational-process/EducationalProcessClient";
import { SITE_URL } from "@/lib/site";

export default function EducationalProcessPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/educational-process#webpage`,
        url: `${SITE_URL}/educational-process`,
        name: "Графік освітнього процесу ДФКР",
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
            name: "Графік освітнього процесу",
            item: `${SITE_URL}/educational-process`,
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
      <EducationalProcessClient />
    </>
  );
}
