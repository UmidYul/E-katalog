import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export default function ForbiddenPage() {
  const t = createTranslator(getRequestLocale());

  return (
    <main className="mx-auto max-w-7xl px-4 py-14">
      <article className="mx-auto max-w-xl rounded-xl border border-border bg-card p-7 text-center md:p-9">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          {t("pages.forbidden.badge")}
        </span>
        <h1 className="mt-4 font-heading text-5xl font-bold tracking-tight">403</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("pages.forbidden.message")}</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-secondary"
        >
          {t("pages.forbidden.cta")}
        </Link>
      </article>
    </main>
  );
}
