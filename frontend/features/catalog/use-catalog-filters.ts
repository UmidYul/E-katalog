"use client";

import { useSearchParams } from "next/navigation";

import { CATEGORY_FILTER_KEYS } from "@/lib/filters/categoryFilters";

const parseOptionalNumber = (raw: string | null): number | undefined => {
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseOptionalPositiveInt = (raw: string | null): number | undefined => {
  const parsed = parseOptionalNumber(raw);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
};

const parseBoolean = (raw: string | null): boolean | undefined => {
  if (raw === null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const ENTITY_REF_PATTERN =
  /^(\d+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/;

const splitMultiValues = (values: string[]): string[] =>
  values
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const parseEntityRefs = (values: string[]): string[] =>
  splitMultiValues(values).filter((value) => ENTITY_REF_PATTERN.test(value));

const parseStringValues = (values: string[]): string[] => {
  const unique = new Set<string>();
  splitMultiValues(values).forEach((value) => unique.add(value));
  return [...unique];
};

export function useCatalogFiltersFromUrl() {
  const searchParams = useSearchParams();

  const q = searchParams.get("q") ?? undefined;
  const sort = (searchParams.get("sort") ?? "popular") as
    | "relevance"
    | "price_asc"
    | "price_desc"
    | "popular"
    | "newest"
    | "discount"
    | "shop_count";
  const category = searchParams.get("category") ?? undefined;
  const categoryId = parseEntityRefs([...searchParams.getAll("category_id"), ...searchParams.getAll("categoryId")])[0];

  const brandId = parseEntityRefs([...searchParams.getAll("brand"), ...searchParams.getAll("brand_id")]);
  const shopId = parseEntityRefs([...searchParams.getAll("shop"), ...searchParams.getAll("store"), ...searchParams.getAll("store_id")]);
  const sellerId = parseEntityRefs([...searchParams.getAll("seller"), ...searchParams.getAll("seller_id")]);

  const minPrice = parseOptionalNumber(searchParams.get("priceMin") ?? searchParams.get("min_price"));
  const maxPrice = parseOptionalNumber(searchParams.get("priceMax") ?? searchParams.get("max_price"));

  const deliveryValues = parseStringValues(
    searchParams.getAll("delivery_days").length
      ? searchParams.getAll("delivery_days")
      : searchParams.get("delivery")
      ? [searchParams.get("delivery") ?? ""]
      : []
  );

  const minRating = parseStringValues(searchParams.getAll("min_rating"));
  const inStock = parseBoolean(searchParams.get("in_stock")) ?? false;
  const hasDiscount = parseBoolean(searchParams.get("has_discount")) ?? false;

  const attrs: Record<string, string[]> = {};

  searchParams
    .getAll("attr")
    .map((entry) => {
      const [key, value] = entry.split(":");
      if (!key || !value) return null;
      return { key: key.trim(), value: value.trim() };
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null)
    .forEach((entry) => {
      attrs[entry.key] = [...(attrs[entry.key] ?? []), entry.value];
    });

  CATEGORY_FILTER_KEYS.forEach((key) => {
    const values = parseStringValues(searchParams.getAll(key));
    if (!values.length) return;
    const merged = new Set<string>([...(attrs[key] ?? []), ...values]);
    attrs[key] = [...merged];
  });

  const pageCursor = searchParams.get("cursor") ?? undefined;
  const page = parseOptionalPositiveInt(searchParams.get("page")) ?? 1;

  return {
    q,
    category,
    category_id: categoryId ?? undefined,
    sort,
    brand_id: brandId.length ? brandId : undefined,
    shop_id: shopId.length ? shopId : undefined,
    store_id: shopId.length ? shopId : undefined,
    seller_id: sellerId.length ? sellerId : undefined,
    min_price: minPrice !== undefined && minPrice >= 0 ? minPrice : undefined,
    max_price: maxPrice !== undefined && maxPrice > 0 ? maxPrice : undefined,
    delivery_days: deliveryValues.length ? deliveryValues : undefined,
    in_stock: inStock,
    has_discount: hasDiscount,
    min_rating: minRating.length ? minRating : undefined,
    cursor: pageCursor,
    page,
    attrs: Object.keys(attrs).length ? attrs : undefined,
  };
}
