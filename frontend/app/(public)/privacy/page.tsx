import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: `${env.appUrl}/privacy` },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 shadow-sm md:p-8">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          Legal
        </span>
        <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight md:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Updated: February 26, 2026</p>

        <div className="mt-6 space-y-5 text-sm text-muted-foreground">
          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Data We Process</h2>
            <p>
              Doxx processes account, catalog interaction, and alert-delivery data to provide product search, price comparison, and
              notifications. We process only the data required for these services.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Core Categories</h2>
            <p>
              Account identifiers, session and security telemetry, favorites and history lists, and alert delivery channels (email or
              telegram when enabled in user settings).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Support & Requests</h2>
            <p>
              For support or data-subject requests, contact us through the contacts page. Policy details will expand as legal review
              finalizes regional requirements.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}

