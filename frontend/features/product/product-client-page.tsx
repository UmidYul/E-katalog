"use client";

import { Heart } from "lucide-react";

import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProduct } from "@/features/catalog/use-catalog-queries";
import { useToggleFavorite } from "@/features/user/use-favorites";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";
import { OfferTable } from "@/components/product/offer-table";
import { ProductQuestionsPanel, ProductReviewsPanel } from "@/components/product/product-feedback-panels";
import { ProductGallery } from "@/components/product/product-gallery";
import { PriceHistoryCard } from "@/components/product/price-history-card";
import { SpecsTable } from "@/components/product/specs-table";
import { useEffect, useState } from "react";

const normalizeCategory = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
};

const getReferenceCompareCategory = (categories: Array<string | undefined>) => {
  for (const category of categories) {
    const normalized = normalizeCategory(category);
    if (normalized) return normalized;
  }
  return undefined;
};

export function ProductClientPage({ productId, slug }: { productId: string; slug: string }) {
  const product = useProduct(productId);
  const toggleFavorite = useToggleFavorite();
  const pushRecentlyViewed = useRecentlyViewedStore((s) => s.push);
  const compareItemsStore = useCompareStore((s) => s.items);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const compareItems = mounted ? compareItemsStore : [];

  useEffect(() => {
    if (product.data) {
      const minPrice = product.data.offers_by_store.reduce((acc, store) => Math.min(acc, store.minimal_price), Number.POSITIVE_INFINITY);
      pushRecentlyViewed({
        id: product.data.id,
        slug,
        title: product.data.title,
        minPrice: Number.isFinite(minPrice) ? minPrice : undefined
      });
    }
  }, [product.data?.id, product.data?.title, pushRecentlyViewed, slug]);

  if (product.error) {
    return <ErrorState title="Product unavailable" message="This product may have been removed." />;
  }

  if (product.isLoading || !product.data) {
    return <div className="container py-8 text-sm text-muted-foreground">Loading product...</div>;
  }

  const inCompare = compareItems.some((item) => item.id === product.data.id);
  const compareFull = compareItems.length >= COMPARE_LIMIT;
  const referenceCompareCategory = getReferenceCompareCategory(compareItems.map((item) => item.category));
  const productCategory = normalizeCategory(product.data.category);
  const categoryMismatch = Boolean(referenceCompareCategory && productCategory && referenceCompareCategory !== productCategory);
  const compareDisabled = !inCompare && (compareFull || categoryMismatch);
  const compareDisabledReason = compareFull ? `Limit is ${COMPARE_LIMIT} products` : categoryMismatch ? "Compare works only within one category" : undefined;
  const galleryImages =
    product.data.gallery_images?.length
      ? product.data.gallery_images
      : product.data.main_image
        ? [product.data.main_image]
        : [];

  return (
    <div className="container space-y-6 py-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/catalog", label: "Catalog" }, { href: `/product/${slug}`, label: product.data.title }]} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <ProductGallery images={galleryImages} />
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h1 className="text-2xl font-semibold">{product.data.title}</h1>
          <p className="text-sm text-muted-foreground">AI-normalized listing with live multi-store price feed.</p>
          <p className="text-sm text-muted-foreground">Category: {product.data.category}</p>
          {product.data.brand ? <p className="text-sm text-muted-foreground">Brand: {product.data.brand}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={() => toggleFavorite.mutate(product.data.id)}>
              <Heart className="h-4 w-4" /> Add to favorites
            </Button>
            <Button
              variant={inCompare ? "default" : "outline"}
              onClick={() =>
                toggleCompare({
                  id: product.data.id,
                  title: product.data.title,
                  slug,
                  category: product.data.category
                })
              }
              disabled={compareDisabled}
              title={compareDisabled ? compareDisabledReason : undefined}
            >
              {inCompare ? "In comparison" : "Add to compare"}
            </Button>
          </div>
        </section>
      </div>

      <Tabs defaultValue="offers" className="space-y-4">
        <TabsList className="flex w-full flex-wrap gap-1 p-1">
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="history">Price history</TabsTrigger>
          <TabsTrigger value="specs">Specifications</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="qa">Q&A</TabsTrigger>
        </TabsList>
        <TabsContent value="offers">
          <OfferTable offersByStore={product.data.offers_by_store ?? []} />
        </TabsContent>
        <TabsContent value="history">
          <PriceHistoryCard productId={product.data.id} />
        </TabsContent>
        <TabsContent value="specs">
          <SpecsTable specs={product.data.specs} />
        </TabsContent>
        <TabsContent value="reviews">
          <ProductReviewsPanel productId={product.data.id} />
        </TabsContent>
        <TabsContent value="qa">
          <ProductQuestionsPanel productId={product.data.id} />
        </TabsContent>
      </Tabs>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.data.title,
            offers: (product.data.offers_by_store ?? []).flatMap((block) =>
              block.offers.map((offer) => ({
                "@type": "Offer",
                price: offer.price_amount,
                priceCurrency: offer.currency,
                availability: offer.in_stock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                seller: { "@type": "Organization", name: offer.seller_name }
              }))
            )
          })
        }}
      />
    </div>
  );
}

