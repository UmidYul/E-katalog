import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: `${env.appUrl}/terms` }
};

export default function TermsPage() {
  return (
    <main className="container py-10">
      <article className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">Updated: February 26, 2026</p>
        <p>
          E-katalog provides informational aggregation of product offers and links to third-party stores. Pricing, availability, and
          final order execution are controlled by the destination store.
        </p>
        <p>
          Users must avoid abusive automation, unauthorized scraping of protected areas, and any actions that impact service stability or
          security.
        </p>
        <p>
          Terms will be extended with jurisdiction-specific clauses during legal review and production launch hardening.
        </p>
      </article>
    </main>
  );
}
