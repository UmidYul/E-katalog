import type { Metadata } from "next";

import { env } from "@/config/env";
import { StatusPageClient } from "@/features/public/status-page-client";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Тизим ҳолати",
    alternates: { canonical: `${env.appUrl}/status` },
  };
}

export default function StatusPage() {
  return <StatusPageClient />;
}
