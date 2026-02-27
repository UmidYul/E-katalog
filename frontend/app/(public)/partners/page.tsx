import type { Metadata } from "next";

import { env } from "@/config/env";
import { PartnerIntakePage } from "@/features/b2b/partner-intake-page";

export const metadata: Metadata = {
  title: "Partners",
  alternates: { canonical: `${env.appUrl}/partners` },
};

export default function PartnersPage() {
  return <PartnerIntakePage />;
}
