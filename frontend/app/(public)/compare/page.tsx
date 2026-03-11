import type { Metadata } from "next";
import { Suspense } from "react";

import { env } from "@/config/env";
import { CompareClientPage } from "@/features/compare/compare-client-page";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(getRequestLocale());
  return {
    title: t("pages.compare.title"),
    alternates: { canonical: `${env.appUrl}/compare` }
  };
}

export default function ComparePage() {
  const t = createTranslator(getRequestLocale());

  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted-foreground">{t("pages.compare.loading")}</div>}>
      <CompareClientPage />
    </Suspense>
  );
}
