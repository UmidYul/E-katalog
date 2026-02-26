import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Service Status",
  alternates: { canonical: `${env.appUrl}/status` }
};

export default function StatusPage() {
  return (
    <main className="container py-10">
      <article className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Service Status</h1>
        <p className="text-sm text-muted-foreground">Operational baseline page</p>
        <p>
          This page documents runtime health endpoints and incident communication channels.
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            API health: <code>/api/v1/health</code>
          </li>
          <li>
            API readiness: <code>/api/v1/ready</code>
          </li>
          <li>
            API liveness: <code>/api/v1/live</code>
          </li>
          <li>
            Metrics: <code>/api/v1/metrics</code>
          </li>
        </ul>
        <p>
          Incident notifications and postmortem updates are published through support channels listed on the contacts page.
        </p>
      </article>
    </main>
  );
}
