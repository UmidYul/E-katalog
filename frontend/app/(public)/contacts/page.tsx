import type { Metadata } from "next";

import { env } from "@/config/env";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(getRequestLocale());
  return {
    title: t("pages.contacts.title"),
    alternates: { canonical: `${env.appUrl}/contacts` },
  };
}

export default function ContactsPage() {
  const t = createTranslator(getRequestLocale());

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-3xl space-y-4 rounded-xl border border-border bg-card p-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{t("pages.contacts.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("pages.contacts.description")}</p>
        <p>
          {t("pages.contacts.support")}{" "}
          <a className="underline decoration-accent underline-offset-4" href="mailto:support@doxx.local">
            support@doxx.local
          </a>
        </p>
        <p>
          {t("pages.contacts.security")}{" "}
          <a className="underline decoration-accent underline-offset-4" href="mailto:security@doxx.local">
            security@doxx.local
          </a>
        </p>
        <p>{t("pages.contacts.note")}</p>
      </article>
    </main>
  );
}
