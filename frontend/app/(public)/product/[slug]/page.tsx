import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { env } from "@/config/env";
import { ProductClientPage } from "@/features/product/product-client-page";
import {
  extractProductRefFromSlug,
  mapProductApiToPageData,
  type ProductApiResponse,
  type ProductReviewItem,
} from "@/features/product/product-types";
import { serverGet } from "@/lib/api/server";
import { formatPrice } from "@/lib/utils/format";

type PageParams = { slug: string };

const loadProduct = async (slug: string) => {
  const productRef = extractProductRefFromSlug(slug);
  if (!productRef) return null;

  try {
    const [product, reviews] = await Promise.all([
      serverGet<ProductApiResponse>(`/products/${productRef}`),
      serverGet<ProductReviewItem[]>(`/products/${productRef}/reviews?limit=60&offset=0`).catch(() => []),
    ]);

    return mapProductApiToPageData(product, {
      slug,
      reviews,
      similar: [],
    });
  } catch {
    return null;
  }
};

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const product = await loadProduct(params.slug);
  const canonical = `${env.appUrl}/product/${params.slug}`;

  if (!product) {
    return {
      title: "Маҳсулот | Doxx",
      alternates: { canonical },
      robots: { index: false, follow: true },
    };
  }

  const description = `${product.name} — Ўзбекистонда ${product.offerCount} та дўкон нархларини солиштиринг. Минимал нарх: ${formatPrice(product.minPrice)} сўм. Нарх тарихи ва хусусиятлар.`;
  const ogImage = product.images[0];

  return {
    title: `${product.name} — Тошкентда нархлар | Doxx`,
    description,
    alternates: { canonical },
    openGraph: {
      title: product.name,
      description: `дан ${formatPrice(product.minPrice)} сўм · ${product.offerCount} дўкон`,
      images: ogImage ? [{ url: ogImage, alt: product.name }] : undefined,
      url: canonical,
      type: "website",
    },
  };
}

export default async function ProductPage({ params }: { params: PageParams }) {
  const product = await loadProduct(params.slug);
  if (!product) notFound();

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.images,
    description: product.description,
    brand: { "@type": "Brand", name: product.brand },
    aggregateRating: product.reviewCount
      ? {
        "@type": "AggregateRating",
        ratingValue: product.rating,
        reviewCount: product.reviewCount,
      }
      : undefined,
    offers: product.offers.map((offer) => ({
      "@type": "Offer",
      price: offer.price,
      priceCurrency: "UZS",
      seller: { "@type": "Organization", name: offer.shopName },
      availability: offer.inStock ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
      url: offer.url,
    })),
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Бош саҳифа", item: `${env.appUrl}/` },
      { "@type": "ListItem", position: 2, name: product.category, item: `${env.appUrl}/catalog` },
      { "@type": "ListItem", position: 3, name: product.brand, item: `${env.appUrl}/catalog?q=${encodeURIComponent(product.brand)}` },
      { "@type": "ListItem", position: 4, name: product.name, item: `${env.appUrl}/product/${params.slug}` },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <ProductClientPage initialProduct={product} />
    </>
  );
}
