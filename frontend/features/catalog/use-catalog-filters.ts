"use client";

import { useSearchParams } from "next/navigation";

const parseOptionalNumber = (raw: string | null): number | undefined => {
  if (raw === null || raw.trim() === "") {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function useCatalogFiltersFromUrl() {
  const searchParams = useSearchParams();

  const q = searchParams.get("q") ?? undefined;
  const sort = (searchParams.get("sort") ?? "popular") as "relevance" | "price_asc" | "price_desc" | "popular" | "newest";
  const brandId = searchParams.getAll("brand").map(Number).filter((v) => Number.isFinite(v));
  const storeId = searchParams.getAll("store").map(Number).filter((v) => Number.isFinite(v));
  const sellerId = searchParams.getAll("seller").map(Number).filter((v) => Number.isFinite(v));
  const minPrice = parseOptionalNumber(searchParams.get("min_price"));
  const maxPrice = parseOptionalNumber(searchParams.get("max_price"));
  const maxDeliveryDays = parseOptionalNumber(searchParams.get("max_delivery_days"));
  const pageCursor = searchParams.get("cursor") ?? undefined;
  const attrs = searchParams
    .getAll("attr")
    .map((entry) => {
      const [key, value] = entry.split(":");
      if (!key || !value) return null;
      return { key, value };
    })
    .filter((x): x is { key: string; value: string } => x !== null)
    .reduce<Record<string, string[]>>((acc, item) => {
      acc[item.key] = [...(acc[item.key] ?? []), item.value];
      return acc;
    }, {});

  return {
    q,
    sort,
    brand_id: brandId.length ? brandId : undefined,
    store_id: storeId.length ? storeId : undefined,
    seller_id: sellerId.length ? sellerId : undefined,
    min_price: minPrice !== undefined && minPrice >= 0 ? minPrice : undefined,
    max_price: maxPrice !== undefined && maxPrice > 0 ? maxPrice : undefined,
    max_delivery_days: maxDeliveryDays !== undefined && maxDeliveryDays >= 0 ? maxDeliveryDays : undefined,
    cursor: pageCursor,
    attrs: Object.keys(attrs).length ? attrs : undefined
  };
}

