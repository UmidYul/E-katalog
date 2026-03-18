import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { env } from "@/config/env";
import { CatalogClientPage } from "@/features/catalog/catalog-client-page";
import { serverGet } from "@/lib/api/server";

type Category = {
  id: string;
  slug: string;
  name: string;
};

type Store = {
  id: string;
  name: string;
};

const loadCategories = async () => {
  try {
    const categories = await serverGet<Category[]>("/categories");
    return Array.isArray(categories) ? categories : [];
  } catch {
    return [] as Category[];
  }
};

const loadStoresCount = async () => {
  try {
    const stores = await serverGet<Store[]>("/stores");
    return Array.isArray(stores) ? stores.length : 0;
  } catch {
    return 0;
  }
};

export async function generateStaticParams() {
  const categories = await loadCategories();
  return categories.slice(0, 10).map((category) => ({ category: category.slug }));
}

export async function generateMetadata({ params }: { params: { category: string } }): Promise<Metadata> {
  const categories = await loadCategories();
  const category = categories.find((item) => item.slug === params.category);
  if (!category) {
    return {
      title: "Каталог | Doxx",
      robots: { index: false, follow: true },
    };
  }

  const storesCount = await loadStoresCount();
  const canonical = `${env.appUrl}/catalog/${category.slug}`;

  return {
    title: `${category.name} в Узбекистане — сравнение цен | Doxx`,
    description: `${category.name}: сравните цены и предложения из ${storesCount} магазинов Узбекистана на Doxx.`,
    alternates: {
      canonical,
    },
    openGraph: {
      title: `${category.name} в Узбекистане — сравнение цен | Doxx`,
      description: `${category.name}: сравните цены и предложения из ${storesCount} магазинов Узбекистана на Doxx.`,
      url: canonical,
      type: "website",
    },
  };
}

export default async function CatalogCategoryPage({ params }: { params: { category: string } }) {
  const categories = await loadCategories();
  const category = categories.find((item) => item.slug === params.category);
  if (!category) {
    notFound();
  }

  return (
    <Suspense fallback={<div className="container py-8 text-sm text-muted-foreground">Юкланмоқда...</div>}>
      <CatalogClientPage
        categoryId={category.id}
        categorySlug={category.slug}
        pageTitle={category.name}
        showCategoryHeading
      />
    </Suspense>
  );
}
