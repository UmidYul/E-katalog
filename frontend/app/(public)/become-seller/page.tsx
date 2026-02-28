import type { Metadata } from "next";
import { PartnerIntakePage } from "@/features/b2b/partner-intake-page";
import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Стать продавцом",
  alternates: { canonical: `${env.appUrl}/become-seller` },
};

export default function BecomeSellerPage() {
  return <PartnerIntakePage />;
}
