import type { Metadata } from "next";

import { env } from "@/config/env";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(getRequestLocale());
  return {
    title: t("pages.legal.termsTitle"),
    alternates: { canonical: `${env.appUrl}/terms` },
  };
}

export default function TermsPage() {
  const t = createTranslator(getRequestLocale());

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 md:p-8">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          {t("pages.legal.badge")}
        </span>
        <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight md:text-4xl">{t("pages.legal.termsTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("pages.legal.updated")}</p>

        <div className="mt-6 space-y-5 text-sm text-muted-foreground">
          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">{t("pages.legal.termsScopeTitle")}</h2>
            <p>{t("pages.legal.termsScopeText")}</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">{t("pages.legal.termsUsageTitle")}</h2>
            <p>{t("pages.legal.termsUsageText")}</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">{t("pages.legal.termsUpdatesTitle")}</h2>
            <p>{t("pages.legal.termsUpdatesText")}</p>
          </section>
        </div>
      </article>
    </main>
  );
}

