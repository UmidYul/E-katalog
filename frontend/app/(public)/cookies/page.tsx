import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Cookie Policy",
  alternates: { canonical: `${env.appUrl}/cookies` }
};

export default function CookiesPage() {
  return (
    <main className="container py-10">
      <article className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Cookie Policy</h1>
        <p className="text-sm text-muted-foreground">Updated: February 26, 2026</p>
        <p>
          We use essential cookies and local storage for authentication, session continuity, and product selection flows (compare,
          favorites, recently viewed).
        </p>
        <p>
          Analytics or marketing cookies are disabled by default in this baseline and will be introduced only with explicit consent
          controls.
        </p>
        <p>
          You can clear browser storage at any time; some user-experience features may degrade until re-authentication.
        </p>
      </article>
    </main>
  );
}
