import type { Metadata } from "next";

import { CatalogClientPage } from "@/features/catalog/catalog-client-page";
import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Catalog",
  alternates: { canonical: `${env.appUrl}/catalog` }
};

export default function CatalogPage() {
  return <CatalogClientPage />;
}

