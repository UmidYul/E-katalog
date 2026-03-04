import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Service Status",
  alternates: { canonical: `${env.appUrl}/status` },
};

export default function StatusPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 md:p-8">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          Platform Operations
        </span>
        <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight md:text-4xl">Service Status</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Runtime health endpoints and incident communication channels are listed below.
        </p>

        <div className="mt-6 space-y-3">
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            API health: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1/health</code>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            API readiness: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1/ready</code>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            API liveness: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1/live</code>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            Metrics: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1/metrics</code>
          </div>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Incident notifications and postmortem updates are published through support channels listed on the contacts page.
        </p>
      </article>
    </main>
  );
}
