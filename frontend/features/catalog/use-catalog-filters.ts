"use client";

import { useSearchParams } from "next/navigation";

const parseOptionalNumber = (raw: string | null): number | undefined => {
  if (raw === null || raw.trim() === "") {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseOptionalPositiveInt = (raw: string | null): number | undefined => {
  const parsed = parseOptionalNumber(raw);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
};

const ENTITY_REF_PATTERN =
  /^(\d+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/;

const parseEntityRefs = (values: string[]): string[] =>
  values.map((value) => value.trim()).filter((value) => ENTITY_REF_PATTERN.test(value));

export function useCatalogFiltersFromUrl() {
  const searchParams = useSearchParams();

  const q = searchParams.get("q") ?? undefined;
  const sort = (searchParams.get("sort") ?? "popular") as "relevance" | "price_asc" | "price_desc" | "popular" | "newest";
  const brandId = parseEntityRefs(searchParams.getAll("brand"));
  const storeId = parseEntityRefs(searchParams.getAll("store"));
  const sellerId = parseEntityRefs(searchParams.getAll("seller"));
  const minPrice = parseOptionalNumber(searchParams.get("min_price"));
  const maxPrice = parseOptionalNumber(searchParams.get("max_price"));
  const maxDeliveryDays = parseOptionalNumber(searchParams.get("max_delivery_days"));
  const pageCursor = searchParams.get("cursor") ?? undefined;
  const page = parseOptionalPositiveInt(searchParams.get("page")) ?? 1;
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
    page,
    attrs: Object.keys(attrs).length ? attrs : undefined
  };
}

