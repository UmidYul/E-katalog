import type { Metadata } from "next";
import { Suspense } from "react";

import { env } from "@/config/env";
import { CatalogClientPage } from "@/features/catalog/catalog-client-page";

export const metadata: Metadata = {
  title: "Каталог техники",
  description:
    "Каталог техники с актуальными ценами, фильтрами по брендам и магазинам, сравнением характеристик и предложений.",
  alternates: { canonical: `${env.appUrl}/catalog` },
  openGraph: {
    title: `Каталог техники | ${env.siteName}`,
    description:
      "Сравнивайте предложения по технике, используйте фильтры и выбирайте лучшие цены.",
    url: `${env.appUrl}/catalog`
  },
  twitter: {
    card: "summary_large_image",
    title: `Каталог техники | ${env.siteName}`,
    description: "Каталог с фильтрами, сравнением и актуальными ценами по магазинам."
  }
};

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="container py-8 text-sm text-muted-foreground">Загрузка каталога...</div>}>
      <CatalogClientPage />
    </Suspense>
  );
}
