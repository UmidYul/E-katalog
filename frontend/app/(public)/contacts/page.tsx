import type { Metadata } from "next";

import { env } from "@/config/env";
import { ContactsPageClient } from "@/features/public/contacts-page-client";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Алоқа",
    alternates: { canonical: `${env.appUrl}/contacts` },
  };
}

export default function ContactsPage() {
  return <ContactsPageClient />;
}
