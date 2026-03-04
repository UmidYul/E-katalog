import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Cookie Policy",
  alternates: { canonical: `${env.appUrl}/cookies` },
};

export default function CookiesPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 md:p-8">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          Legal
        </span>
        <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight md:text-4xl">Cookie Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Updated: February 26, 2026</p>

        <div className="mt-6 space-y-5 text-sm text-muted-foreground">
          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Essential Storage</h2>
            <p>
              We use essential cookies and local storage for authentication, session continuity, and product selection flows including
              compare, favorites, and recently viewed.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Optional Cookies</h2>
            <p>
              Analytics or marketing cookies are disabled by default in this baseline and will be introduced only with explicit consent
              controls.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">Storage Reset</h2>
            <p>
              You can clear browser storage at any time. Some user-experience features may degrade until re-authentication.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
