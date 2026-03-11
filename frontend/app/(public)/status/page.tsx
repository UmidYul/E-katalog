import type { Metadata } from "next";

import { env } from "@/config/env";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(getRequestLocale());
  return {
    title: t("pages.status.title"),
    alternates: { canonical: `${env.appUrl}/status` },
  };
}

export default function StatusPage() {
  const t = createTranslator(getRequestLocale());

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 md:p-8">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          {t("pages.status.badge")}
        </span>
        <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight md:text-4xl">{t("pages.status.subtitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("pages.status.description")}
        </p>

        <div className="mt-6 space-y-3">
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            {t("pages.status.apiHealth")} <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1/health</code>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            {t("pages.status.apiReadiness")} <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1/ready</code>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            {t("pages.status.apiLiveness")} <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1/live</code>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            {t("pages.status.metrics")} <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1/metrics</code>
          </div>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          {t("pages.status.note")}
        </p>
      </article>
    </main>
  );
}
