import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Контакты",
  alternates: { canonical: `${env.appUrl}/contacts` },
};

export default function ContactsPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-3xl space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Контакты</h1>
        <p className="text-sm text-muted-foreground">Каналы связи для поддержки пользователей и юридических запросов.</p>
        <p>
          Поддержка пользователей:{" "}
          <a className="underline decoration-accent underline-offset-4" href="mailto:support@doxx.local">
            support@doxx.local
          </a>
        </p>
        <p>
          Security disclosures:{" "}
          <a className="underline decoration-accent underline-offset-4" href="mailto:security@doxx.local">
            security@doxx.local
          </a>
        </p>
        <p>Для ускорения обработки обращений укажите контекст запроса и контактный email в теме письма.</p>
      </article>
    </main>
  );
}
