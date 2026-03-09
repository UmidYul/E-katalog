import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { env } from "@/config/env";
import { CatalogClientPage } from "@/features/catalog/catalog-client-page";
import { serverGet } from "@/lib/api/server";
import { buildCategoryFaq, buildCategorySeoParagraphs, toFaqJsonLd } from "@/lib/seo/content";

type Category = { id: string; slug: string; name: string };
type Brand = { id: string; name: string; products_count?: number };

const BRAND_CATEGORY_PREFIX = "brand-";
const LEGACY_SMARTPHONE_BRAND_PREFIX = "smartphone-";

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const formatBrandLabelFromSlug = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const resolveVirtualCategory = (slug: string, categories: Category[], brands: Brand[]) => {
  const isGenericBrandCategory = slug.startsWith(BRAND_CATEGORY_PREFIX);
  const isLegacySmartphoneBrandCategory = slug.startsWith(LEGACY_SMARTPHONE_BRAND_PREFIX);
  if (!isGenericBrandCategory && !isLegacySmartphoneBrandCategory) return null;

  const prefix = isGenericBrandCategory ? BRAND_CATEGORY_PREFIX : LEGACY_SMARTPHONE_BRAND_PREFIX;
  const brandSlug = slug.slice(prefix.length).trim();
  if (!brandSlug) return null;

  const brand = brands.find((item) => slugify(item.name) === brandSlug);
  const fallbackQuery = brandSlug.replace(/-/g, " ").trim() || brandSlug;
  const brandLabel = brand?.name ?? formatBrandLabelFromSlug(brandSlug);

  if (isGenericBrandCategory) {
    return {
      categoryId: undefined,
      brandId: brand?.id,
      presetQuery: brand ? undefined : fallbackQuery,
      title: `Бренд: ${brandLabel}`
    };
  }

  const baseCategory =
    categories.find((item) => item.slug === "phones") ??
    categories.find((item) => ["smartphones", "smartfonlar", "smartfony"].includes(item.slug.toLowerCase())) ??
    categories.find((item) => item.name.toLowerCase().includes("smart"));
  if (!baseCategory) return null;

  return {
    categoryId: baseCategory.id,
    brandId: brand?.id,
    presetQuery: brand ? undefined : fallbackQuery,
    title: `${baseCategory.name} - ${brandLabel}`
  };
};

async function loadCategoryIndex(): Promise<{ categories: Category[]; brands: Brand[] }> {
  try {
    const [categories, brands] = await Promise.all([serverGet<Category[]>("/categories"), serverGet<Brand[]>("/brands")]);
    return {
      categories: Array.isArray(categories) ? categories : [],
      brands: Array.isArray(brands) ? brands : []
    };
  } catch {
    return { categories: [], brands: [] };
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { categories, brands } = await loadCategoryIndex();
  const canonical = `${env.appUrl}/category/${params.slug}`;

  const category = categories.find((item) => item.slug === params.slug);
  if (category) {
    const title = `${category.name}: цены и предложения`;
    const description = `Сравнение цен, магазинов и характеристик по категории ${category.name}. Выберите лучшее предложение.`;
    return {
      title,
      description,
      keywords: [category.name, "цены", "сравнение", "каталог"],
      alternates: { canonical },
      openGraph: {
        title: `${title} | ${env.siteName}`,
        description,
        url: canonical,
        type: "website"
      },
      twitter: {
        card: "summary_large_image",
        title: `${title} | ${env.siteName}`,
        description
      }
    };
  }

  const virtual = resolveVirtualCategory(params.slug, categories, brands);
  if (virtual) {
    const title = `${virtual.title}: цены и предложения`;
    const description = `Сравнение цен и магазинов по подборке ${virtual.title}.`;
    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        title: `${title} | ${env.siteName}`,
        description,
        url: canonical,
        type: "website"
      },
      twitter: {
        card: "summary_large_image",
        title: `${title} | ${env.siteName}`,
        description
      }
    };
  }

  return {
    title: `Категория: ${params.slug}`,
    description: "Страница категории каталога товаров.",
    alternates: { canonical },
    robots: {
      index: false,
      follow: true
    }
  };
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const { categories, brands } = await loadCategoryIndex();
  if (!categories.length && !brands.length) {
    notFound();
  }

  const category = categories.find((item) => item.slug === params.slug);
  if (category) {
    const faq = buildCategoryFaq(category.name);
    const seoParagraphs = buildCategorySeoParagraphs(category.name);

    return (
      <>
        <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">Загрузка каталога...</div>}>
          <CatalogClientPage categoryId={category.id} pageTitle={category.name} />
        </Suspense>
        <section className="mx-auto max-w-7xl space-y-2 px-4 pb-8 text-sm text-muted-foreground">
          {seoParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(toFaqJsonLd(faq))
          }}
        />
      </>
    );
  }

  const virtual = resolveVirtualCategory(params.slug, categories, brands);
  if (!virtual) {
    notFound();
  }

  const faq = buildCategoryFaq(virtual.title);
  const seoParagraphs = buildCategorySeoParagraphs(virtual.title);

  return (
    <>
      <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">Загрузка каталога...</div>}>
        <CatalogClientPage categoryId={virtual.categoryId} presetBrandId={virtual.brandId} presetQuery={virtual.presetQuery} pageTitle={virtual.title} />
      </Suspense>
      <section className="mx-auto max-w-7xl space-y-2 px-4 pb-8 text-sm text-muted-foreground">
        {seoParagraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(toFaqJsonLd(faq))
        }}
      />
    </>
  );
}
