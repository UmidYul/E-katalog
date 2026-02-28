import type { Metadata } from "next";

import { env } from "@/config/env";
import { PartnerStatusPage } from "@/features/b2b/partner-status-page";

type SearchParams = {
  lead?: string;
  token?: string;
  [key: string]: string | string[] | undefined;
};

export const metadata: Metadata = {
  title: "Partner Application Status",
  alternates: { canonical: `${env.appUrl}/partners/status` },
};

export default function PartnersStatusPage({ searchParams }: { searchParams: SearchParams }) {
  const lead = Array.isArray(searchParams.lead) ? searchParams.lead[0] : searchParams.lead;
  const token = Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;
  return <PartnerStatusPage initialLeadId={lead} initialToken={token} />;
}
