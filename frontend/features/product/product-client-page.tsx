"use client";

import { Heart } from "lucide-react";

import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { useProduct, useProductOffers } from "@/features/catalog/use-catalog-queries";
import { useToggleFavorite } from "@/features/user/use-favorites";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";
import { OfferTable } from "@/components/product/offer-table";
import { ProductGallery } from "@/components/product/product-gallery";
import { SpecsTable } from "@/components/product/specs-table";
import { useEffect } from "react";

export function ProductClientPage({ productId, slug }: { productId: number; slug: string }) {
  const product = useProduct(productId);
  const offers = useProductOffers(productId);
  const toggleFavorite = useToggleFavorite();
  const recentlyViewed = useRecentlyViewedStore();

  useEffect(() => {
    if (product.data) {
      recentlyViewed.push({
        id: product.data.id,
        slug,
        title: product.data.normalized_title,
        minPrice: undefined
      });
    }
  }, [product.data, recentlyViewed, slug]);

  if (product.error) {
    return <ErrorState title="Product unavailable" message="This product may have been removed." />;
  }

  if (product.isLoading || !product.data) {
    return <div className="container py-8 text-sm text-muted-foreground">Loading product...</div>;
  }

  return (
    <div className="container space-y-6 py-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/catalog", label: "Catalog" }, { href: `/product/${slug}`, label: product.data.normalized_title }]} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <ProductGallery images={[]} />
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h1 className="text-2xl font-semibold">{product.data.normalized_title}</h1>
          <p className="text-sm text-muted-foreground">AI-normalized listing with live multi-store price feed.</p>
          <Button className="gap-2" onClick={() => toggleFavorite.mutate(product.data.id)}>
            <Heart className="h-4 w-4" /> Add to favorites
          </Button>
        </section>
      </div>

      <OfferTable offers={offers.data ?? []} />
      <SpecsTable specs={product.data.specs} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.data.normalized_title,
            offers: (offers.data ?? []).map((offer) => ({
              "@type": "Offer",
              price: offer.price_amount,
              priceCurrency: offer.currency,
              availability: offer.in_stock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
              seller: { "@type": "Organization", name: offer.store.name }
            }))
          })
        }}
      />
    </div>
  );
}

