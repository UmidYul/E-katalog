import type { Metadata } from "next";
import { Suspense } from "react";

import { env } from "@/config/env";
import { CatalogClientPage } from "@/features/catalog/catalog-client-page";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(getRequestLocale());
  return {
    title: t("pages.catalog.title"),
    description: t("pages.catalog.description"),
    alternates: { canonical: `${env.appUrl}/catalog` },
    openGraph: {
      title: t("pages.catalog.ogTitle", { siteName: env.siteName }),
      description: t("pages.catalog.ogDescription"),
      url: `${env.appUrl}/catalog`
    },
    twitter: {
      card: "summary_large_image",
      title: t("pages.catalog.ogTitle", { siteName: env.siteName }),
      description: t("pages.catalog.twitterDescription")
    }
  };
}

export default function CatalogPage() {
  const t = createTranslator(getRequestLocale());

  return (
    <Suspense fallback={<div className="container py-8 text-sm text-muted-foreground">{t("pages.catalog.loading")}</div>}>
      <CatalogClientPage />
    </Suspense>
  );
}
