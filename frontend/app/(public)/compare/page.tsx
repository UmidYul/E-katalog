import type { Metadata } from "next";

import { env } from "@/config/env";
import { CompareClientPage } from "@/features/compare/compare-client-page";

export const metadata: Metadata = {
  title: "Compare products",
  alternates: { canonical: `${env.appUrl}/compare` }
};

export default function ComparePage() {
  return <CompareClientPage />;
}
