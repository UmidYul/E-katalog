import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "@/config/env";
import { CatalogClientPage } from "@/features/catalog/catalog-client-page";
import { serverGet } from "@/lib/api/server";

type Category = { id: string; slug: string; name: string };
type Brand = { id: string; name: string };

const BRAND_CATEGORY_PREFIX = "smartphone-";
const BRAND_QUERY_FALLBACK: Record<string, string> = {
  apple: "apple iphone",
  samsung: "samsung galaxy"
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const resolveVirtualCategory = (slug: string, categories: Category[], brands: Brand[]) => {
  if (!slug.startsWith(BRAND_CATEGORY_PREFIX)) {
    return null;
  }

  const brandSlug = slug.slice(BRAND_CATEGORY_PREFIX.length);
  if (!brandSlug) {
    return null;
  }

  const baseCategory =
    categories.find((item) => item.slug === "phones") ??
    categories.find((item) => ["smartphones", "smartfonlar", "smartfony"].includes(item.slug.toLowerCase())) ??
    categories.find((item) => {
      const name = item.name.toLowerCase();
      return name.includes("smart") || name.includes("смартф");
    });
  if (!baseCategory) {
    return null;
  }

  const brand = brands.find((item) => slugify(item.name) === brandSlug);
  const fallbackQuery = BRAND_QUERY_FALLBACK[brandSlug] ?? brandSlug;
  const brandLabel = brand?.name ?? brandSlug.charAt(0).toUpperCase() + brandSlug.slice(1);

  return {
    categoryId: baseCategory.id,
    brandId: brand?.id,
    presetQuery: brand ? undefined : fallbackQuery,
    title: `${baseCategory.name} - ${brandLabel}`,
  };
};

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  return {
    title: `Category: ${params.slug}`,
    alternates: { canonical: `${env.appUrl}/category/${params.slug}` }
  };
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  let categories: Category[] = [];
  let brands: Brand[] = [];
  try {
    [categories, brands] = await Promise.all([serverGet<Category[]>("/categories"), serverGet<Brand[]>("/brands")]);
  } catch {
    notFound();
  }

  const category = categories.find((item) => item.slug === params.slug);
  if (category) {
    return <CatalogClientPage categoryId={category.id} pageTitle={category.name} />;
  }

  const virtual = resolveVirtualCategory(params.slug, categories, brands);
  if (!virtual) {
    notFound();
  }

  return (
    <CatalogClientPage
      categoryId={virtual.categoryId}
      presetBrandId={virtual.brandId}
      presetQuery={virtual.presetQuery}
      pageTitle={virtual.title}
    />
  );
}

