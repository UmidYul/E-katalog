"use client";

import { useSearchParams } from "next/navigation";

export function useCatalogFiltersFromUrl() {
  const searchParams = useSearchParams();

  const q = searchParams.get("q") ?? undefined;
  const sort = (searchParams.get("sort") ?? "popular") as "relevance" | "price_asc" | "price_desc" | "popular" | "newest";
  const brandId = searchParams.getAll("brand").map(Number).filter((v) => Number.isFinite(v));
  const minPrice = Number(searchParams.get("min_price") ?? "");
  const maxPrice = Number(searchParams.get("max_price") ?? "");
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
    min_price: Number.isFinite(minPrice) ? minPrice : undefined,
    max_price: Number.isFinite(maxPrice) ? maxPrice : undefined,
    cursor: pageCursor,
    attrs: Object.keys(attrs).length ? attrs : undefined
  };
}

