import type { Metadata } from "next";
import { Suspense } from "react";

import { env } from "@/config/env";
import { CompareClientPage } from "@/features/compare/compare-client-page";

export const metadata: Metadata = {
  title: "Сравнение товаров",
  alternates: { canonical: `${env.appUrl}/compare` }
};

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="h-24" />}>
      <CompareClientPage />
    </Suspense>
  );
}
