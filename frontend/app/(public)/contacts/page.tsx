import type { Metadata } from "next";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Contacts",
  alternates: { canonical: `${env.appUrl}/contacts` }
};

export default function ContactsPage() {
  return (
    <main className="container py-10">
      <article className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground">Support channel baseline</p>
        <p>
          Product and account support: <a className="underline" href="mailto:support@doxx.local">support@doxx.local</a>
        </p>
        <p>
          Security disclosures: <a className="underline" href="mailto:security@doxx.local">security@doxx.local</a>
        </p>
        <p>
          For legal requests, include account email and request context in the message subject for faster triage.
        </p>
      </article>
    </main>
  );
}

