"use client";

import { useParams } from "next/navigation";

import { OfferTable } from "@/components/product/offer-table";
import { ProductGallery } from "@/components/product/product-gallery";
import { SpecsTable } from "@/components/product/specs-table";
import { useProduct } from "@/features/catalog/use-catalog-queries";

export default function AdminProductDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const product = useProduct(id);

  if (product.isLoading || !product.data) {
    return <p className="text-sm text-muted-foreground">Loading product...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ProductGallery images={product.data.main_image ? [product.data.main_image] : []} />
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-xl font-semibold">{product.data.title}</h2>
          <p className="text-sm text-muted-foreground">Category: {product.data.category}</p>
          <p className="text-sm text-muted-foreground">Brand: {product.data.brand ?? "No brand"}</p>
        </div>
      </div>
      <OfferTable offersByStore={product.data.offers_by_store} />
      <SpecsTable specs={product.data.specs} />
    </div>
  );
}
