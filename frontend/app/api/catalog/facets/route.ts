import { NextResponse } from "next/server";

import { serverGet } from "@/lib/api/server";
import { getCategoryFilterGroups } from "@/lib/filters/categoryFilters";

type Category = { id: string; slug: string; name: string };

type BrandOption = { id: string; name: string; products_count?: number };

type FiltersResponse = {
  stores?: Array<{ id: string; name: string; offers_count?: number }>;
  sellers?: Array<{ id: string; name: string; offers_count?: number }>;
};

type ProductSearchResponse = {
  total?: number;
};

type FacetsResponse = {
  brands: Array<{ id: string; name: string; count: number }>;
  stores: Array<{ id: string; name: string; count: number }>;
  sellers: Array<{ id: string; name: string; count: number }>;
  category_counts: Record<string, Record<string, number>>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OPTIONS_PER_GROUP = 24;

const splitCsvValues = (values: string[]) =>
  values
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const parseEntityRefs = (values: string[]) =>
  splitCsvValues(values).filter((value) => UUID_PATTERN.test(value));

const parseStringValues = (values: string[]) => [...new Set(splitCsvValues(values))];

const toBoolean = (value: string | null): boolean | undefined => {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const deliveryValuesToMaxDays = (values: string[]) => {
  const mapped = values
    .map((value) => {
      if (value === "today") return 0;
      if (value === "days_1_3") return 3;
      if (value === "week") return 7;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : undefined;
    })
    .filter((value): value is number => value !== undefined);
  if (!mapped.length) return undefined;
  return Math.max(...mapped);
};

const resolveCategoryId = async (rawCategory: string | null): Promise<string | undefined> => {
  const normalized = String(rawCategory ?? "").trim();
  if (!normalized) return undefined;
  if (UUID_PATTERN.test(normalized)) return normalized;

  try {
    const categories = await serverGet<Category[]>("/categories");
    const matched = (categories ?? []).find((item) => String(item.slug ?? "").trim().toLowerCase() === normalized.toLowerCase());
    return matched?.id;
  } catch {
    return undefined;
  }
};

const appendMany = (params: URLSearchParams, key: string, values: string[]) => {
  values.forEach((value) => params.append(key, value));
};

const dedupeOptions = <T extends { id: string }>(items: T[], selectedIds: string[]): T[] => {
  const selectedSet = new Set(selectedIds);
  const selected = items.filter((item) => selectedSet.has(item.id));
  const rest = items.filter((item) => !selectedSet.has(item.id));
  return [...selected, ...rest].slice(0, MAX_OPTIONS_PER_GROUP);
};

const flattenAttrs = (attrs: Record<string, string[]>) =>
  Object.entries(attrs).flatMap(([key, values]) => values.map((value) => `${key}:${value}`));

const buildSearchParams = ({
  categoryId,
  q,
  minPrice,
  maxPrice,
  maxDeliveryDays,
  inStock,
  attrs,
  brands,
  stores,
  sellers,
}: {
  categoryId?: string;
  q?: string;
  minPrice?: string;
  maxPrice?: string;
  maxDeliveryDays?: number;
  inStock?: boolean;
  attrs: Record<string, string[]>;
  brands: string[];
  stores: string[];
  sellers: string[];
}) => {
  const params = new URLSearchParams();
  params.set("limit", "1");
  params.set("sort", "popular");
  if (categoryId) params.set("category_id", categoryId);
  if (q) params.set("q", q);
  if (minPrice) params.set("min_price", minPrice);
  if (maxPrice) params.set("max_price", maxPrice);
  if (maxDeliveryDays !== undefined) params.set("max_delivery_days", String(maxDeliveryDays));
  if (inStock !== undefined) params.set("in_stock", String(inStock));

  appendMany(params, "attr", flattenAttrs(attrs));
  appendMany(params, "brand_id", brands);
  appendMany(params, "store_id", stores);
  appendMany(params, "seller_id", sellers);
  return params;
};

const fetchCount = async (params: URLSearchParams): Promise<number> => {
  try {
    const payload = await serverGet<ProductSearchResponse>(`/products?${params.toString()}`);
    return Math.max(0, Number(payload?.total ?? 0));
  } catch {
    return 0;
  }
};

const buildCategoryAttrs = (query: URLSearchParams, category: string | undefined) => {
  const attrs: Record<string, string[]> = {};

  const legacyAttrs = query
    .getAll("attr")
    .map((entry) => {
      const [key, value] = String(entry ?? "").split(":");
      if (!key || !value) return null;
      return { key: key.trim(), value: value.trim() };
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null);

  legacyAttrs.forEach((entry) => {
    attrs[entry.key] = [...(attrs[entry.key] ?? []), entry.value];
  });

  const groups = getCategoryFilterGroups(category);
  groups.forEach((group) => {
    const values = parseStringValues(query.getAll(group.key));
    if (!values.length) return;
    attrs[group.key] = [...new Set([...(attrs[group.key] ?? []), ...values])];
  });

  return attrs;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams;

    const category = query.get("category") ?? undefined;
    const categoryId = await resolveCategoryId(category ?? null);

    const q = query.get("q") ?? undefined;
    const minPrice = query.get("priceMin") ?? query.get("min_price") ?? undefined;
    const maxPrice = query.get("priceMax") ?? query.get("max_price") ?? undefined;
    const inStock = toBoolean(query.get("in_stock"));
    const deliveryDays = parseStringValues(
      query.getAll("delivery_days").length ? query.getAll("delivery_days") : query.get("delivery") ? [query.get("delivery") ?? ""] : []
    );
    const maxDeliveryDays = deliveryValuesToMaxDays(deliveryDays);

    const selectedBrands = parseEntityRefs([...query.getAll("brand"), ...query.getAll("brand_id")]);
    const selectedStores = parseEntityRefs([...query.getAll("shop"), ...query.getAll("store"), ...query.getAll("store_id")]);
    const selectedSellers = parseEntityRefs([...query.getAll("seller"), ...query.getAll("seller_id")]);
    const selectedAttrs = buildCategoryAttrs(query, category);

    const [brandsRaw, filtersRaw] = await Promise.all([
      serverGet<BrandOption[]>(`/brands${categoryId ? `?category_id=${encodeURIComponent(categoryId)}&limit=60` : "?limit=60"}`),
      serverGet<FiltersResponse>(`/filters${categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : ""}`),
    ]);

    const brands = dedupeOptions(Array.isArray(brandsRaw) ? brandsRaw : [], selectedBrands);
    const stores = dedupeOptions(filtersRaw?.stores ?? [], selectedStores);
    const sellers = dedupeOptions(filtersRaw?.sellers ?? [], selectedSellers);

    const countBase = {
      categoryId,
      q,
      minPrice,
      maxPrice,
      maxDeliveryDays,
      inStock,
      attrs: selectedAttrs,
    };

    const brandCounts = await Promise.all(
      brands.map(async (brand) => ({
        id: brand.id,
        name: brand.name,
        count: await fetchCount(
          buildSearchParams({
            ...countBase,
            brands: [brand.id],
            stores: selectedStores,
            sellers: selectedSellers,
          })
        ),
      }))
    );

    const storeCounts = await Promise.all(
      stores.map(async (store) => ({
        id: store.id,
        name: store.name,
        count: await fetchCount(
          buildSearchParams({
            ...countBase,
            brands: selectedBrands,
            stores: [store.id],
            sellers: selectedSellers,
          })
        ),
      }))
    );

    const sellerCounts = await Promise.all(
      sellers.map(async (seller) => ({
        id: seller.id,
        name: seller.name,
        count: await fetchCount(
          buildSearchParams({
            ...countBase,
            brands: selectedBrands,
            stores: selectedStores,
            sellers: [seller.id],
          })
        ),
      }))
    );

    const categoryGroups = getCategoryFilterGroups(category);
    const checkboxGroups = categoryGroups.filter((group) => group.type === "checkbox" && group.options?.length);

    const category_counts: Record<string, Record<string, number>> = {};

    await Promise.all(
      checkboxGroups.map(async (group) => {
        const groupCounts: Record<string, number> = {};
        const options = group.options ?? [];

        await Promise.all(
          options.map(async (option) => {
            const attrsWithOption = {
              ...selectedAttrs,
              [group.key]: [option.value],
            };

            groupCounts[option.value] = await fetchCount(
              buildSearchParams({
                ...countBase,
                attrs: attrsWithOption,
                brands: selectedBrands,
                stores: selectedStores,
                sellers: selectedSellers,
              })
            );
          })
        );

        category_counts[group.key] = groupCounts;
      })
    );

    const payload: FacetsResponse = {
      brands: brandCounts,
      stores: storeCounts,
      sellers: sellerCounts,
      category_counts,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        brands: [],
        stores: [],
        sellers: [],
        category_counts: {},
      } satisfies FacetsResponse,
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
