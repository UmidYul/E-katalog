import type { Metadata } from "next";
import { Suspense } from "react";

import { CatalogClientPage } from "@/features/catalog/catalog-client-page";
import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Catalog",
  alternates: { canonical: `${env.appUrl}/catalog` }
};

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="container py-8 text-sm text-muted-foreground">Loading catalog...</div>}>
      <CatalogClientPage />
    </Suspense>
  );
}

