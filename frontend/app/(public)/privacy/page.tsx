import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: `${env.appUrl}/privacy` }
};

export default function PrivacyPage() {
  return (
    <main className="container py-10">
      <article className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Updated: February 26, 2026</p>
        <p>
          E-katalog processes account, catalog interaction, and alert-delivery data to provide product search, price comparison, and
          notifications. We process only the data required for these services.
        </p>
        <p>
          Core categories of data: account identifiers, session/security telemetry, favorites/history lists, and alert delivery channels
          (email/telegram when enabled by user settings).
        </p>
        <p>
          For support or data-subject requests, contact us via the contacts page. Policy details are expanded as legal review finalizes
          regional requirements.
        </p>
      </article>
    </main>
  );
}
