import type { Metadata } from "next";

import { env } from "@/config/env";
import { PartnerIntakePage } from "@/features/b2b/partner-intake-page";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(getRequestLocale());
  return {
    title: t("pages.becomeSeller.metadataTitle"),
    alternates: { canonical: `${env.appUrl}/become-seller` },
  };
}

export default function BecomeSellerPage() {
  return <PartnerIntakePage />;
}
