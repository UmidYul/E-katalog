import { HomeClient } from "@/features/catalog/home-client";
import type { Metadata } from "next";

import { env } from "@/config/env";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(getRequestLocale());
  const title = t("rootMeta.titleDefault", { siteName: env.siteName });
  return {
    title,
    description: t("rootMeta.description"),
    alternates: { canonical: `${env.appUrl}/` },
    openGraph: {
      title,
      description: t("rootMeta.ogDescription"),
      url: env.appUrl,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: t("rootMeta.twitterDescription"),
    }
  };
}

export default function HomePage() {
  const locale = getRequestLocale();

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
        inLanguage: locale === "uz-Cyrl-UZ" ? "uz-Cyrl" : "ru",
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
