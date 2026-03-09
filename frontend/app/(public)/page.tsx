import { HomeClient } from "@/features/catalog/home-client";
import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Сравнение цен на технику",
  description:
    "Сравнивайте цены на смартфоны, ноутбуки и другую электронику. Находите лучшие предложения от проверенных магазинов.",
  alternates: { canonical: `${env.appUrl}/` },
  openGraph: {
    title: `Сравнение цен на технику | ${env.siteName}`,
    description:
      "Актуальные цены, сравнение характеристик и предложения от магазинов в одном месте.",
    url: env.appUrl
  },
  twitter: {
    card: "summary_large_image",
    title: `Сравнение цен на технику | ${env.siteName}`,
    description: "Актуальные цены и сравнение характеристик техники."
  }
};

export default function HomePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${env.appUrl}#organization`,
        name: env.siteName,
        url: env.appUrl
      },
      {
        "@type": "WebSite",
        "@id": `${env.appUrl}#website`,
        url: env.appUrl,
        name: env.siteName,
        inLanguage: "ru",
        publisher: { "@id": `${env.appUrl}#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: `${env.appUrl}/catalog?q={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      }
    ]
  };

  return (
    <>
      <HomeClient />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData)
        }}
      />
    </>
  );
}
