import type { Metadata } from "next";

import { env } from "@/config/env";
import { PartnerIntakePage } from "@/features/b2b/partner-intake-page";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Сотувчи бўлиш",
    alternates: { canonical: `${env.appUrl}/become-seller` },
  };
}

export default function BecomeSellerPage() {
  return <PartnerIntakePage />;
}
