"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { CatalogFilters, type FilterState } from "@/components/catalog/catalog-filters";
import { CatalogGrid } from "@/components/catalog/catalog-grid";
import { ErrorState } from "@/components/common/error-state";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { useCatalogFiltersFromUrl } from "@/features/catalog/use-catalog-filters";
import { useBrands, useCatalogProducts, useDynamicFilters } from "@/features/catalog/use-catalog-queries";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { debounceMs } from "@/lib/utils/format";

const toQueryString = (filters: FilterState & { cursor?: string }) => {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.minPrice !== undefined) params.set("min_price", String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set("max_price", String(filters.maxPrice));
  if (filters.maxDeliveryDays !== undefined) params.set("max_delivery_days", String(filters.maxDeliveryDays));
  if (filters.cursor) params.set("cursor", filters.cursor);
  filters.brands.forEach((brand) => params.append("brand", String(brand)));
  filters.stores.forEach((store) => params.append("store", String(store)));
  filters.sellers.forEach((seller) => params.append("seller", String(seller)));
  Object.entries(filters.attrs ?? {}).forEach(([key, values]) => {
    values.forEach((value) => params.append("attr", `${key}:${value}`));
  });
  return params.toString();
};

export function CatalogClientPage({ categoryId }: { categoryId?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = useCatalogFiltersFromUrl();

  const filters: FilterState = {
    q: fromUrl.q,
    sort: fromUrl.sort,
    minPrice: fromUrl.min_price,
    maxPrice: fromUrl.max_price,
    maxDeliveryDays: fromUrl.max_delivery_days,
    brands: fromUrl.brand_id ?? [],
    stores: fromUrl.store_id ?? [],
    sellers: fromUrl.seller_id ?? [],
    attrs: fromUrl.attrs
  };

  const debounced = useDebouncedValue(filters, debounceMs.filters);

  const queryPayload = useMemo(
    () => ({
      q: debounced.q,
      sort: debounced.sort,
      min_price: debounced.minPrice,
      max_price: debounced.maxPrice,
      max_delivery_days: debounced.maxDeliveryDays,
      brand_id: debounced.brands,
      store_id: debounced.stores,
      seller_id: debounced.sellers,
      attrs: debounced.attrs,
      category_id: categoryId,
      cursor: fromUrl.cursor,
      limit: 24
    }),
    [categoryId, debounced, fromUrl.cursor]
  );

  const products = useCatalogProducts(queryPayload);
  const brands = useBrands();
  const dynamicFilters = useDynamicFilters(categoryId);

  const onFiltersChange = (next: FilterState) => {
    const query = toQueryString(next);
    router.replace(`/catalog${query ? `?${query}` : ""}`, { scroll: false });
  };

  if (products.error) {
    return <ErrorState title="Could not load catalog" message="Check connection and retry." />;
  }

  return (
    <div className="container space-y-6 py-6">
      <SectionHeading title="Catalog" description="Compare prices across trusted stores in seconds." />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <CatalogFilters
          brands={brands.data ?? []}
          stores={dynamicFilters.data?.stores}
          sellers={dynamicFilters.data?.sellers}
          dynamicAttributes={dynamicFilters.data?.attributes}
          value={filters}
          onChange={onFiltersChange}
        />

        <div className="space-y-4">
          <CatalogGrid loading={products.isLoading} items={products.data?.items ?? []} />
          {products.data?.next_cursor ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set("cursor", products.data?.next_cursor ?? "");
                router.push(`/catalog?${params.toString()}`);
              }}
            >
              Load more
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

