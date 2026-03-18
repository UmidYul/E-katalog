"use client";

import { useQuery } from "@tanstack/react-query";
import { Grid3X3, List, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CatalogFilters, type FilterState } from "@/components/catalog/catalog-filters";
import { CatalogGrid, ProductGridSkeleton, type CatalogViewMode } from "@/components/catalog/catalog-grid";
import { Breadcrumb } from "@/components/common/breadcrumbs";
import { EmptyState } from "@/components/common/empty-state";
import { useLocale } from "@/components/common/locale-provider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCatalogFiltersFromUrl } from "@/features/catalog/use-catalog-filters";
import { useBrands, useCatalogProducts, useCategories, useDynamicFilters } from "@/features/catalog/use-catalog-queries";
import {
  COMMON_DELIVERY_OPTIONS,
  COMMON_MIN_RATING_OPTIONS,
  getCategoryFilterGroupByKey,
  getCategoryFilterGroups,
  parseRangeValue,
} from "@/lib/filters/categoryFilters";
import { useCompareStore } from "@/store/compare.store";

const DEFAULT_SORT: FilterState["sort"] = "popular";
const CATALOG_ROOT_PATH = "/catalog";

const CATEGORY_CHIPS = [
  { label: "Барчаси", value: null },
  { label: "Смартфонлар", value: "smartphones" },
  { label: "Ноутбуклар", value: "laptops" },
  { label: "Телевизорлар", value: "tv" },
  { label: "Қулоқчинлар", value: "headphones" },
  { label: "Планшетлар", value: "tablets" },
  { label: "Камералар", value: "cameras" },
  { label: "Гейминг", value: "gaming" },
  { label: "Аксессуарлар", value: "accessories" },
] as const;

const SORT_OPTIONS: Array<{ value: FilterState["sort"]; label: string }> = [
  { value: "popular", label: "Оммабоплиги бўйича" },
  { value: "price_asc", label: "Аввал арзон" },
  { value: "price_desc", label: "Аввал қиммат" },
  { value: "newest", label: "Янгиликлар" },
  { value: "discount", label: "Чегирма ҳажми бўйича" },
  { value: "shop_count", label: "Таклифлар сони бўйича" },
  { value: "relevance", label: "Мослиги бўйича" },
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalize = (value: unknown) => String(value ?? "").trim();
const formatNumber = (value: number) => new Intl.NumberFormat("uz-Cyrl-UZ").format(value);
const buildCatalogPath = (category?: string | null) => (category ? `${CATALOG_ROOT_PATH}/${category}` : CATALOG_ROOT_PATH);

const uniqueValues = (values: string[]) => [...new Set(values.filter(Boolean))];

const normalizeDeliveryValues = (values?: string[]) => {
  const normalized = (values ?? [])
    .map((entry) => entry.trim().toLowerCase())
    .flatMap((entry) => {
      if (entry === "today" || entry === "days_1_3" || entry === "week") return [entry];
      const numeric = Number(entry);
      if (!Number.isFinite(numeric)) return [];
      if (numeric <= 0) return ["today"];
      if (numeric <= 3) return ["days_1_3"];
      if (numeric <= 7) return ["week"];
      return [];
    });
  return uniqueValues(normalized);
};

const normalizeRatings = (values?: string[]) => {
  const normalized = (values ?? [])
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry === "3" || entry === "4");
  return uniqueValues(normalized);
};

const deliveryValuesToMaxDays = (values: string[]) => {
  const mapped: number[] = [];
  values.forEach((entry) => {
    if (entry === "today") mapped.push(0);
    else if (entry === "days_1_3") mapped.push(3);
    else if (entry === "week") mapped.push(7);
  });
  if (!mapped.length) return undefined;
  return Math.max(...mapped);
};

const sanitizeAttrsForCategory = (attrs: Record<string, string[]> | undefined, categoryToken?: string) => {
  if (!attrs || !categoryToken) return undefined;
  const allowedKeys = new Set(getCategoryFilterGroups(categoryToken).map((group) => group.key));
  const next = Object.entries(attrs).reduce<Record<string, string[]>>((acc, [key, values]) => {
    if (!allowedKeys.has(key)) return acc;
    if (!values.length) return acc;
    acc[key] = uniqueValues(values);
    return acc;
  }, {});
  return Object.keys(next).length ? next : undefined;
};

const appendJoinedParam = (params: URLSearchParams, key: string, values: string[]) => {
  if (!values.length) return;
  params.set(key, uniqueValues(values).join(","));
};

const filterDeliveryLabelMap = new Map(COMMON_DELIVERY_OPTIONS.map((item) => [item.value, item.label]));
const minRatingLabelMap = new Map(COMMON_MIN_RATING_OPTIONS.map((item) => [item.value, item.label]));

type FacetsPayload = {
  brands: Array<{ id: string; name: string; count: number }>;
  stores: Array<{ id: string; name: string; count: number }>;
  sellers: Array<{ id: string; name: string; count: number }>;
  category_counts: Record<string, Record<string, number>>;
};

export function CatalogClientPage({
  categoryId,
  categorySlug,
  presetBrandId,
  presetQuery,
  pageTitle,
  showCategoryHeading = false,
}: {
  categoryId?: string;
  categorySlug?: string;
  presetBrandId?: string;
  presetQuery?: string;
  pageTitle?: string;
  showCategoryHeading?: boolean;
}) {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";

  const router = useRouter();
  const pathname = usePathname();

  const fromUrl = useCatalogFiltersFromUrl();
  const categories = useCategories();

  const categoryIdFromUrl = fromUrl.category_id;
  const selectedCategoryToken = categorySlug ?? fromUrl.category ?? undefined;
  const categoryGroups = useMemo(() => getCategoryFilterGroups(selectedCategoryToken), [selectedCategoryToken]);

  const resolvedCategoryId = useMemo(() => {
    if (categoryId) return categoryId;
    if (categoryIdFromUrl) return categoryIdFromUrl;
    if (!selectedCategoryToken) return undefined;
    if (UUID_PATTERN.test(selectedCategoryToken)) return selectedCategoryToken;

    const normalizedCategory = selectedCategoryToken.toLowerCase();
    const list = categories.data ?? [];

    const exact = list.find((item) => normalize(item.slug).toLowerCase() === normalizedCategory);
    if (exact) return exact.id;

    const findBy = (matcher: (slug: string, name: string) => boolean) =>
      list.find((item) => matcher(normalize(item.slug).toLowerCase(), normalize(item.name).toLowerCase()))?.id;

    if (normalizedCategory === "smartphones") {
      return findBy((slug, name) => slug.includes("phone") || slug.includes("smart") || name.includes("смартфон") || name.includes("smart"));
    }
    if (normalizedCategory === "laptops") {
      return findBy((slug, name) => slug.includes("laptop") || slug.includes("nout") || name.includes("ноут"));
    }
    if (normalizedCategory === "tv") {
      return findBy((slug, name) => slug.includes("tv") || slug.includes("telev") || name.includes("телев"));
    }
    if (normalizedCategory === "headphones") {
      return findBy((slug, name) => slug.includes("head") || slug.includes("ear") || name.includes("науш") || name.includes("қулоқ"));
    }
    if (normalizedCategory === "tablets") {
      return findBy((slug, name) => slug.includes("tablet") || slug.includes("plan") || name.includes("планш"));
    }
    if (normalizedCategory === "cameras" || normalizedCategory === "photo") {
      return findBy((slug, name) => slug.includes("photo") || slug.includes("camera") || name.includes("фото") || name.includes("камера"));
    }
    if (normalizedCategory === "gaming") {
      return findBy((slug, name) => slug.includes("game") || name.includes("игр") || name.includes("ўйин"));
    }
    if (normalizedCategory === "accessories") {
      return findBy((slug, name) => slug.includes("accessor") || name.includes("аксесс") || name.includes("аксуар"));
    }

    return undefined;
  }, [categories.data, categoryId, categoryIdFromUrl, selectedCategoryToken]);

  const filters = useMemo<FilterState>(
    () => ({
      q: fromUrl.q ?? presetQuery,
      sort: fromUrl.sort ?? DEFAULT_SORT,
      brands: uniqueValues([...(fromUrl.brand_id ?? []), ...(presetBrandId ? [presetBrandId] : [])]),
      stores: uniqueValues(fromUrl.shop_id ?? fromUrl.store_id ?? []),
      sellers: uniqueValues(fromUrl.seller_id ?? []),
      minPrice: fromUrl.min_price,
      maxPrice: fromUrl.max_price,
      deliveryDays: normalizeDeliveryValues(fromUrl.delivery_days),
      inStock: Boolean(fromUrl.in_stock),
      hasDiscount: Boolean(fromUrl.has_discount),
      minRating: normalizeRatings(fromUrl.min_rating),
      attrs: sanitizeAttrsForCategory(fromUrl.attrs, selectedCategoryToken),
    }),
    [fromUrl, presetBrandId, presetQuery, selectedCategoryToken]
  );

  const toSearchParams = useCallback(
    (next: FilterState, categoryToken?: string | null, categoryIdRef?: string) => {
      const params = new URLSearchParams();
      if (next.q?.trim()) params.set("q", next.q.trim());
      if (next.sort !== DEFAULT_SORT) params.set("sort", next.sort);
      if (categoryIdRef && !categoryToken) params.set("category_id", categoryIdRef);
      if (next.minPrice !== undefined) params.set("priceMin", String(next.minPrice));
      if (next.maxPrice !== undefined) params.set("priceMax", String(next.maxPrice));
      if (next.inStock) params.set("in_stock", "true");
      if (next.hasDiscount) params.set("has_discount", "true");
      appendJoinedParam(params, "brand", next.brands);
      appendJoinedParam(params, "shop", next.stores);
      appendJoinedParam(params, "seller", next.sellers);
      appendJoinedParam(params, "delivery_days", next.deliveryDays);
      appendJoinedParam(params, "min_rating", next.minRating);

      const groups = getCategoryFilterGroups(categoryToken ?? undefined);
      groups.forEach((group) => {
        const values = next.attrs?.[group.key] ?? [];
        if (!values.length) return;
        if (group.type === "toggle") {
          if (values.includes("true")) params.set(group.key, "true");
          return;
        }
        appendJoinedParam(params, group.key, values);
      });

      return params;
    },
    []
  );

  const catalogQuery = useMemo(
    () => ({
      q: filters.q,
      sort: filters.sort,
      min_price: filters.minPrice,
      max_price: filters.maxPrice,
      max_delivery_days: deliveryValuesToMaxDays(filters.deliveryDays),
      in_stock: filters.inStock || undefined,
      brand_id: filters.brands,
      store_id: filters.stores,
      seller_id: filters.sellers,
      attrs: filters.attrs,
      category_id: resolvedCategoryId,
      limit: 24,
    }),
    [filters, resolvedCategoryId]
  );

  const products = useCatalogProducts(catalogQuery);
  const brands = useBrands({ categoryId: resolvedCategoryId });
  const dynamicFilters = useDynamicFilters(resolvedCategoryId);

  const facetsParams = useMemo(() => {
    const params = toSearchParams(filters, selectedCategoryToken, resolvedCategoryId);
    if (selectedCategoryToken) params.set("category", selectedCategoryToken);
    else if (resolvedCategoryId) params.set("category", resolvedCategoryId);
    return params.toString();
  }, [filters, resolvedCategoryId, selectedCategoryToken, toSearchParams]);

  const facets = useQuery({
    queryKey: ["catalog", "facets", facetsParams],
    queryFn: async () => {
      const response = await fetch(`/api/catalog/facets${facetsParams ? `?${facetsParams}` : ""}`, { cache: "no-store" });
      if (!response.ok) {
        return {
          brands: [],
          stores: [],
          sellers: [],
          category_counts: {},
        } satisfies FacetsPayload;
      }
      return (await response.json()) as FacetsPayload;
    },
    staleTime: 60_000,
  });

  const brandOptions = useMemo(() => {
    const counts = new Map((facets.data?.brands ?? []).map((item) => [item.id, item.count]));
    return (brands.data ?? []).map((item) => ({ id: item.id, name: item.name, count: counts.get(item.id) ?? item.products_count ?? 0 }));
  }, [brands.data, facets.data?.brands]);

  const storeOptions = useMemo(() => {
    const fallback = dynamicFilters.data?.stores ?? [];
    if (facets.data?.stores?.length) return facets.data.stores;
    return fallback.map((item) => ({ id: item.id, name: item.name, count: 0 }));
  }, [dynamicFilters.data?.stores, facets.data?.stores]);

  const [viewMode, setViewMode] = useState<CatalogViewMode>("grid");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("doxx_catalog_view");
      if (stored === "grid" || stored === "list") setViewMode(stored);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("doxx_catalog_view", viewMode);
    } catch {
      // ignore storage errors
    }
  }, [viewMode]);

  const applyFilters = useCallback(
    (next: FilterState, nextCategoryToken?: string | null) => {
      const explicitCategoryChange = nextCategoryToken !== undefined;
      const categoryValue = categoryId
        ? selectedCategoryToken
        : explicitCategoryChange
        ? (nextCategoryToken ?? undefined)
        : selectedCategoryToken;
      const categoryIdRef = categoryId
        ? undefined
        : explicitCategoryChange && nextCategoryToken === null
        ? undefined
        : categoryValue
        ? undefined
        : resolvedCategoryId;
      const params = toSearchParams(next, categoryValue, categoryIdRef);
      const targetPath = categoryId ? pathname : categoryValue ? buildCatalogPath(categoryValue) : CATALOG_ROOT_PATH;
      router.replace(`${targetPath}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
    },
    [categoryId, pathname, resolvedCategoryId, router, selectedCategoryToken, toSearchParams]
  );

  const resetFilters = useCallback(() => {
    applyFilters(
      {
        q: presetQuery,
        sort: DEFAULT_SORT,
        brands: presetBrandId ? [presetBrandId] : [],
        stores: [],
        sellers: [],
        minPrice: undefined,
        maxPrice: undefined,
        deliveryDays: [],
        inStock: false,
        hasDiscount: false,
        minRating: [],
        attrs: undefined,
      }
    );
  }, [applyFilters, presetBrandId, presetQuery]);

  const handleCategoryChange = useCallback(
    (nextCategory: string | null) => {
      const current = selectedCategoryToken ?? null;
      if (current === nextCategory) return;

      applyFilters(
        {
          ...filters,
          sellers: [],
          attrs: undefined,
        },
        nextCategory
      );
    },
    [applyFilters, filters, selectedCategoryToken]
  );

  const currentCategoryLabel = useMemo(() => {
    if (pageTitle) return pageTitle;
    if (selectedCategoryToken) {
      const chip = CATEGORY_CHIPS.find((item) => item.value === selectedCategoryToken);
      if (chip) return chip.label;
      const category = (categories.data ?? []).find((item) => item.slug === selectedCategoryToken || item.id === resolvedCategoryId);
      if (category?.name) return category.name;
      return selectedCategoryToken;
    }
    return "Каталог";
  }, [pageTitle, selectedCategoryToken, categories.data, resolvedCategoryId]);

  const activeFilters = useMemo(() => {
    const tags: Array<{ key: string; label: string; remove: () => void }> = [];

    if (filters.q?.trim()) {
      tags.push({ key: "q", label: `Қидирув: ${filters.q.trim()}`, remove: () => applyFilters({ ...filters, q: undefined }) });
    }

    filters.brands.forEach((id) => {
      const label = brandOptions.find((item) => item.id === id)?.name ?? id;
      tags.push({
        key: `brand:${id}`,
        label,
        remove: () => applyFilters({ ...filters, brands: filters.brands.filter((entry) => entry !== id) }),
      });
    });

    filters.stores.forEach((id) => {
      const label = storeOptions.find((item) => item.id === id)?.name ?? id;
      tags.push({
        key: `shop:${id}`,
        label,
        remove: () => applyFilters({ ...filters, stores: filters.stores.filter((entry) => entry !== id) }),
      });
    });

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const from = filters.minPrice !== undefined ? formatNumber(filters.minPrice) : "0";
      const to = filters.maxPrice !== undefined ? formatNumber(filters.maxPrice) : "∞";
      tags.push({
        key: "price",
        label: `${from} - ${to}`,
        remove: () => applyFilters({ ...filters, minPrice: undefined, maxPrice: undefined }),
      });
    }

    filters.deliveryDays.forEach((value) => {
      const label = filterDeliveryLabelMap.get(value) ?? value;
      tags.push({
        key: `delivery:${value}`,
        label,
        remove: () => applyFilters({ ...filters, deliveryDays: filters.deliveryDays.filter((entry) => entry !== value) }),
      });
    });

    if (filters.inStock) {
      tags.push({
        key: "in_stock",
        label: "Фақат мавжудлари",
        remove: () => applyFilters({ ...filters, inStock: false }),
      });
    }

    if (filters.hasDiscount) {
      tags.push({
        key: "has_discount",
        label: "Фақат чегирмадаги",
        remove: () => applyFilters({ ...filters, hasDiscount: false }),
      });
    }

    filters.minRating.forEach((value) => {
      tags.push({
        key: `min_rating:${value}`,
        label: minRatingLabelMap.get(value) ?? `★${value}`,
        remove: () => applyFilters({ ...filters, minRating: filters.minRating.filter((entry) => entry !== value) }),
      });
    });

    Object.entries(filters.attrs ?? {}).forEach(([key, values]) => {
      const group = getCategoryFilterGroupByKey(selectedCategoryToken, key);
      values.forEach((value) => {
        let label = `${key}: ${value}`;
        if (group?.type === "toggle") label = group.label;
        if (group?.type === "checkbox") {
          label = group.options?.find((option) => option.value === value)?.label ?? label;
        }
        if (group?.type === "range") {
          const parsed = parseRangeValue(value);
          if (parsed) {
            const unit = group.unit ? ` ${group.unit}` : "";
            label = `${group.label}: ${parsed.min}${unit} - ${parsed.max}${unit}`;
          }
        }

        tags.push({
          key: `attr:${key}:${value}`,
          label,
          remove: () => {
            const nextAttrs = { ...(filters.attrs ?? {}) };
            const nextValues = (nextAttrs[key] ?? []).filter((entry) => entry !== value);
            if (nextValues.length) nextAttrs[key] = nextValues;
            else delete nextAttrs[key];
            applyFilters({ ...filters, attrs: Object.keys(nextAttrs).length ? nextAttrs : undefined });
          },
        });
      });
    });

    return tags;
  }, [applyFilters, brandOptions, filters, isUz, selectedCategoryToken, storeOptions]);

  const compareItems = useCompareStore((state) => state.items);
  const clearCompare = useCompareStore((state) => state.clear);

  const total = products.data?.total ?? 0;
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-8">
      <div className="space-y-2">
        <Breadcrumb items={[{ label: isUz ? "Бош саҳифа" : "Главная", href: "/" }, { label: currentCategoryLabel }]} />
        {showCategoryHeading ? <h1 className="font-heading text-2xl font-bold text-foreground md:text-3xl">{currentCategoryLabel}</h1> : null}
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)] md:items-start">
        <CatalogFilters
          categoryToken={selectedCategoryToken}
          categoryFilters={categoryGroups}
          categoryFacetCounts={facets.data?.category_counts}
          brands={brandOptions}
          stores={storeOptions}
          value={filters}
          onChange={(next) => applyFilters(next)}
          onReset={resetFilters}
        />

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={filters.sort} onValueChange={(sort) => applyFilters({ ...filters, sort: sort as FilterState["sort"] })}>
                <SelectTrigger className="w-[250px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">{isUz ? `Топилди ${formatNumber(total)} та товар` : `Найдено ${formatNumber(total)} товаров`}</span>
            </div>

            <div className="inline-flex rounded-xl border border-border bg-card p-1">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`rounded-lg px-3 py-1.5 ${viewMode === "grid" ? "bg-accent text-white" : "text-muted-foreground"}`}
                aria-label="Grid view"
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-lg px-3 py-1.5 ${viewMode === "list" ? "bg-accent text-white" : "text-muted-foreground"}`}
                aria-label="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {!categoryId ? (
            <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {CATEGORY_CHIPS.map((chip) => {
                const active = (selectedCategoryToken ?? null) === chip.value;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => handleCategoryChange(chip.value)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      active ? "border-accent bg-accent text-white" : "border-border bg-card text-foreground"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {activeFilters.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {activeFilters.map((filter) => (
                <span key={filter.key} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-3 py-1 text-xs text-accent">
                  {filter.label}
                  <button type="button" onClick={filter.remove} className="rounded p-0.5 hover:bg-accent/10" aria-label="Remove filter">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button type="button" onClick={resetFilters} className="text-xs font-semibold text-accent hover:underline">
                Барчасини тозалаш
              </button>
            </div>
          ) : null}

          {products.isLoading ? (
            <ProductGridSkeleton count={12} mode={viewMode} />
          ) : total === 0 && hasActiveFilters ? (
            <EmptyState
              icon={<span className="text-2xl">🔍</span>}
              title={isUz ? "Ҳеч нарса топилмади" : "Ничего не найдено"}
              description={isUz ? "Фильтрларни ўзгартириб кўринг" : "Попробуйте изменить фильтры"}
              action={<Button onClick={resetFilters}>Фильтрларни тозалаш</Button>}
            />
          ) : total === 0 ? (
            <EmptyState icon={<span className="text-2xl">📦</span>} title={isUz ? "Товарлар тез орада қўшилади" : "Товары скоро появятся"} />
          ) : (
            <CatalogGrid loading={products.isFetching && !products.data} items={products.data?.items ?? []} viewMode={viewMode} />
          )}
        </div>
      </div>

      {compareItems.length >= 2 ? (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
            <div className="flex -space-x-2">
              {compareItems.slice(0, 4).map((item) => (
                <div key={item.id} className="h-9 w-9 overflow-hidden rounded-full border border-border bg-card">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">#{item.id.slice(0, 2)}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="text-sm font-medium text-foreground">{isUz ? `Солиштириляпти: ${compareItems.length} та товар` : `Сравниваю: ${compareItems.length} товара`}</div>
            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/compare"
                className="inline-flex items-center rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
              >
                {isUz ? "Солиштириш →" : "Сравнить →"}
              </Link>
              <button type="button" onClick={clearCompare} className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
