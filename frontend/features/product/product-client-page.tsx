"use client";

import { Heart } from "lucide-react";

import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { useProduct } from "@/features/catalog/use-catalog-queries";
import { useToggleFavorite } from "@/features/user/use-favorites";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";
import { OfferTable } from "@/components/product/offer-table";
import { ProductGallery } from "@/components/product/product-gallery";
import { SpecsTable } from "@/components/product/specs-table";
import { useEffect } from "react";

export function ProductClientPage({ productId, slug }: { productId: number; slug: string }) {
  const product = useProduct(productId);
  const toggleFavorite = useToggleFavorite();
  const pushRecentlyViewed = useRecentlyViewedStore((s) => s.push);

  useEffect(() => {
    if (product.data) {
      pushRecentlyViewed({
        id: product.data.id,
        slug,
        title: product.data.title,
        minPrice: undefined
      });
    }
  }, [product.data?.id, product.data?.title, pushRecentlyViewed, slug]);

  if (product.error) {
    return <ErrorState title="Product unavailable" message="This product may have been removed." />;
  }

  if (product.isLoading || !product.data) {
    return <div className="container py-8 text-sm text-muted-foreground">Loading product...</div>;
  }

  return (
    <div className="container space-y-6 py-6">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/catalog", label: "Catalog" }, { href: `/product/${slug}`, label: product.data.title }]} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <ProductGallery images={product.data.main_image ? [product.data.main_image] : []} />
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h1 className="text-2xl font-semibold">{product.data.title}</h1>
          <p className="text-sm text-muted-foreground">AI-normalized listing with live multi-store price feed.</p>
          <p className="text-sm text-muted-foreground">Category: {product.data.category}</p>
          {product.data.brand ? <p className="text-sm text-muted-foreground">Brand: {product.data.brand}</p> : null}
          <Button className="gap-2" onClick={() => toggleFavorite.mutate(product.data.id)}>
            <Heart className="h-4 w-4" /> Add to favorites
          </Button>
        </section>
      </div>

      <OfferTable offersByStore={product.data.offers_by_store ?? []} />
      <SpecsTable specs={product.data.specs} />

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

