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
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-6 text-sm text-muted-foreground">Загружаем сравнение...</div>}>
      <CompareClientPage />
    </Suspense>
  );
}
