"use client";

import { useParams } from "next/navigation";

import { OfferTable } from "@/components/product/offer-table";
import { ProductGallery } from "@/components/product/product-gallery";
import { SpecsTable } from "@/components/product/specs-table";
import { useProduct } from "@/features/catalog/use-catalog-queries";

export default function AdminProductDetailsPage() {
  const params = useParams<{ id: string }>();
  const productRef = params.id;
  const product = useProduct(productRef);

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
          {product.data.short_description ? (
            <div className="mt-3 rounded-xl border border-border/70 bg-background/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">РљСЂР°С‚РєРѕРµ РѕРїРёСЃР°РЅРёРµ</p>
              <p className="mt-1 text-sm">{product.data.short_description}</p>
            </div>
          ) : null}
          <div className="mt-3 rounded-xl border border-border/70 bg-background/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Р§С‚Рѕ РЅРѕРІРѕРіРѕ</p>
            {product.data.whats_new?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                {product.data.whats_new.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">РќРѕРІС‹Рµ РѕС‚Р»РёС‡РёСЏ РїРѕРєР° РЅРµ РѕРїСЂРµРґРµР»РµРЅС‹.</p>
            )}
          </div>
        </div>
      </div>
      <OfferTable offersByStore={product.data.offers_by_store} />
      <SpecsTable specs={product.data.specs} />
    </div>
  );
}

