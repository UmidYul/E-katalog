import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: `${env.appUrl}/terms` },
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 shadow-sm md:p-8">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          Legal
        </span>
        <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight md:text-4xl">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Updated: February 26, 2026</p>

        <div className="mt-6 space-y-5 text-sm text-muted-foreground">
          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Service Scope</h2>
            <p>
              Doxx provides informational aggregation of product offers and links to third-party stores. Pricing, availability, and final
              order execution are controlled by the destination store.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Acceptable Use</h2>
            <p>
              Users must avoid abusive automation, unauthorized scraping of protected areas, and actions that can impact service stability
              or security.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Future Updates</h2>
            <p>
              Terms will be extended with jurisdiction-specific clauses during legal review and production launch hardening.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}

