"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CatalogFilters, type FilterState } from "@/components/catalog/catalog-filters";
import { CatalogGrid } from "@/components/catalog/catalog-grid";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { useCatalogFiltersFromUrl } from "@/features/catalog/use-catalog-filters";
import { useBrands, useCatalogProducts, useDynamicFilters } from "@/features/catalog/use-catalog-queries";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { debounceMs } from "@/lib/utils/format";

const PRICE_MIN = 0;
const PRICE_MAX = 100_000_000;
const DEFAULT_SORT: FilterState["sort"] = "popular";
const EMPTY_FILTERS: FilterState = { sort: DEFAULT_SORT, brands: [], stores: [], sellers: [] };
const mergeUnique = (values: string[]) => Array.from(new Set(values));
const sortLabelMap: Record<FilterState["sort"], string> = {
  popular: "Популярные",
  relevance: "Релевантные",
  price_asc: "Цена: по возрастанию",
  price_desc: "Цена: по убыванию",
  newest: "Сначала новые",
};

const toQueryString = (filters: FilterState & { cursor?: string; page?: number }) => {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.minPrice !== undefined) params.set("min_price", String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set("max_price", String(filters.maxPrice));
  if (filters.maxDeliveryDays !== undefined) params.set("max_delivery_days", String(filters.maxDeliveryDays));
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  if (filters.cursor) params.set("cursor", filters.cursor);
  filters.brands.forEach((brand) => params.append("brand", String(brand)));
  filters.stores.forEach((store) => params.append("store", String(store)));
  filters.sellers.forEach((seller) => params.append("seller", String(seller)));
  Object.entries(filters.attrs ?? {}).forEach(([key, values]) => {
    values.forEach((value) => params.append("attr", `${key}:${value}`));
  });
  return params.toString();
};

const getActiveFilterCount = (filters: FilterState, priceMaxBound: number = PRICE_MAX) => {
  const attrCount = Object.values(filters.attrs ?? {}).reduce((acc, values) => acc + values.length, 0);
  const hasMinPrice = filters.minPrice !== undefined && filters.minPrice > PRICE_MIN;
  const hasMaxPrice = filters.maxPrice !== undefined && filters.maxPrice < priceMaxBound;

  return (
    (filters.q?.trim() ? 1 : 0) +
    (filters.sort !== DEFAULT_SORT ? 1 : 0) +
    filters.brands.length +
    filters.stores.length +
    filters.sellers.length +
    (hasMinPrice ? 1 : 0) +
    (hasMaxPrice ? 1 : 0) +
    (filters.maxDeliveryDays !== undefined ? 1 : 0) +
    attrCount
  );
};

const getProductTopPrice = (item?: { min_price?: number | null; max_price?: number | null }) => {
  if (!item) return undefined;
  const candidates = [item.max_price, item.min_price].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (!candidates.length) return undefined;
  return Math.max(...candidates);
};

export function CatalogClientPage({
  categoryId,
  presetBrandId,
  presetQuery,
  pageTitle,
}: {
  categoryId?: string;
  presetBrandId?: string;
  presetQuery?: string;
  pageTitle?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromUrl = useCatalogFiltersFromUrl();
  const currentPage = Math.max(fromUrl.page ?? 1, 1);
  const [cursorByPage, setCursorByPage] = useState<Record<number, string | undefined>>({ 1: undefined });

  const paginationKey = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cursor");
    params.delete("page");
    if (categoryId !== undefined) params.set("category_id", String(categoryId));
    if (presetBrandId !== undefined) params.set("preset_brand_id", String(presetBrandId));
    return params.toString();
  }, [categoryId, presetBrandId, searchParams]);

  const filters = useMemo<FilterState>(
    () => ({
      q: fromUrl.q ?? presetQuery,
      sort: fromUrl.sort,
      minPrice: fromUrl.min_price,
      maxPrice: fromUrl.max_price,
      maxDeliveryDays: fromUrl.max_delivery_days,
      brands: mergeUnique([...(fromUrl.brand_id ?? []), ...(presetBrandId ? [presetBrandId] : [])]),
      stores: fromUrl.store_id ?? [],
      sellers: fromUrl.seller_id ?? [],
      attrs: fromUrl.attrs,
    }),
    [
      fromUrl.attrs,
      fromUrl.brand_id,
      fromUrl.max_delivery_days,
      fromUrl.max_price,
      fromUrl.min_price,
      fromUrl.q,
      fromUrl.seller_id,
      fromUrl.sort,
      fromUrl.store_id,
      presetBrandId,
      presetQuery,
    ]
  );

  useEffect(() => {
    setCursorByPage({ 1: undefined });
  }, [paginationKey]);

  useEffect(() => {
    if (currentPage <= 1 || !fromUrl.cursor) return;
    setCursorByPage((prev) => (prev[currentPage] === fromUrl.cursor ? prev : { ...prev, [currentPage]: fromUrl.cursor }));
  }, [currentPage, fromUrl.cursor]);

  const debounced = useDebouncedValue(filters, debounceMs.filters);

  const queryPayload = useMemo(
    () => ({
      q: debounced.q,
      sort: debounced.sort,
      min_price: debounced.minPrice,
      max_price: debounced.maxPrice,
      max_delivery_days: debounced.maxDeliveryDays,
      brand_id: mergeUnique([...(debounced.brands ?? []), ...(presetBrandId ? [presetBrandId] : [])]),
      store_id: debounced.stores,
      seller_id: debounced.sellers,
      attrs: debounced.attrs,
      category_id: categoryId,
      cursor: fromUrl.cursor,
      limit: 24,
    }),
    [categoryId, debounced, fromUrl.cursor, presetBrandId]
  );

  const priceBoundsQueryPayload = useMemo(
    () => ({
      q: debounced.q,
      sort: "price_desc" as const,
      max_delivery_days: debounced.maxDeliveryDays,
      brand_id: mergeUnique([...(debounced.brands ?? []), ...(presetBrandId ? [presetBrandId] : [])]),
      store_id: debounced.stores,
      seller_id: debounced.sellers,
      attrs: debounced.attrs,
      category_id: categoryId,
      limit: 1,
    }),
    [categoryId, debounced, presetBrandId]
  );

  const products = useCatalogProducts(queryPayload);
  const priceBoundsProbe = useCatalogProducts(priceBoundsQueryPayload);
  const brands = useBrands();
  const dynamicFilters = useDynamicFilters(categoryId);
  const priceMaxBound = useMemo(() => {
    const probeMax = getProductTopPrice(priceBoundsProbe.data?.items?.[0]);
    const pageMax = Math.max(...(products.data?.items ?? []).map((item) => getProductTopPrice(item) ?? 0), 0);
    const upperBound = probeMax ?? pageMax;
    return upperBound > PRICE_MIN ? Math.max(PRICE_MIN + 1, Math.ceil(upperBound)) : PRICE_MAX;
  }, [priceBoundsProbe.data?.items, products.data?.items]);
  const activeFilterCount = useMemo(() => getActiveFilterCount(filters, priceMaxBound), [filters, priceMaxBound]);
  const hasNextPage = Boolean(products.data?.next_cursor);
  const canGoPrevPage = currentPage > 1 && (currentPage === 2 || Boolean(cursorByPage[currentPage - 1]));
  const showPagination = (products.data?.items?.length ?? 0) > 0 || currentPage > 1;

  useEffect(() => {
    const nextCursor = products.data?.next_cursor ?? undefined;
    if (!nextCursor) return;
    setCursorByPage((prev) => (prev[currentPage + 1] === nextCursor ? prev : { ...prev, [currentPage + 1]: nextCursor }));
  }, [currentPage, products.data?.next_cursor]);

  const pageButtons = useMemo(() => {
    const pages = new Set<number>([currentPage]);
    if (currentPage > 1) pages.add(1);
    if (canGoPrevPage) pages.add(currentPage - 1);
    if (hasNextPage) pages.add(currentPage + 1);
    return Array.from(pages).sort((a, b) => a - b);
  }, [canGoPrevPage, currentPage, hasNextPage]);

  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (filters.q?.trim()) chips.push(`Поиск: ${filters.q.trim()}`);
    if (filters.sort !== DEFAULT_SORT) chips.push(`Сортировка: ${sortLabelMap[filters.sort]}`);
    if (filters.brands.length) chips.push(`Бренды: ${filters.brands.length}`);
    if (filters.stores.length) chips.push(`Магазины: ${filters.stores.length}`);
    if (filters.sellers.length) chips.push(`Продавцы: ${filters.sellers.length}`);
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) chips.push("Цена: задан диапазон");
    if (filters.maxDeliveryDays !== undefined) chips.push(`Доставка: до ${filters.maxDeliveryDays} дн.`);
    const attrsCount = Object.values(filters.attrs ?? {}).reduce((acc, values) => acc + values.length, 0);
    if (attrsCount) chips.push(`Характеристики: ${attrsCount}`);
    return chips.slice(0, 8);
  }, [filters]);

  const onFiltersChange = (next: FilterState) => {
    const payload: FilterState = {
      ...next,
      q: next.q ?? presetQuery,
      brands: mergeUnique([...(next.brands ?? []), ...(presetBrandId ? [presetBrandId] : [])]),
    };
    const query = toQueryString(payload);
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };

  const clearFilters = () =>
    onFiltersChange({
      ...EMPTY_FILTERS,
      q: presetQuery,
      brands: presetBrandId ? [presetBrandId] : [],
    });

  const goToPage = (targetPage: number) => {
    if (targetPage < 1 || targetPage === currentPage) return;

    const params = new URLSearchParams(searchParams.toString());
    if (targetPage === 1) {
      params.delete("page");
      params.delete("cursor");
    } else {
      const targetCursor = targetPage === currentPage + 1 ? (products.data?.next_cursor ?? cursorByPage[targetPage]) : cursorByPage[targetPage];
      if (!targetCursor) return;
      params.set("page", String(targetPage));
      params.set("cursor", targetCursor);
    }

    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
  };

  if (products.error) {
    return <ErrorState title="Не удалось загрузить каталог" message="Проверьте соединение и попробуйте ещё раз." />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-1 px-1"
      >
        <h1 className="font-heading text-2xl font-bold text-foreground md:text-3xl">{pageTitle ?? "Каталог"}</h1>
        <p className="text-sm text-muted-foreground">Сравнивайте цены и предложения по проверенным магазинам.</p>
      </motion.section>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <CatalogFilters
          brands={brands.data ?? []}
          stores={dynamicFilters.data?.stores}
          sellers={dynamicFilters.data?.sellers}
          dynamicAttributes={dynamicFilters.data?.attributes}
          priceMaxBound={priceMaxBound}
          value={filters}
          onChange={onFiltersChange}
        />

        <div className="space-y-4">
          <div className="space-y-3 px-1 py-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                  {products.data?.items.length ?? 0} товаров
                </span>
                <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                  Стр. {currentPage}
                </span>
                {activeFilterCount ? (
                  <span className="rounded-md bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">
                    {activeFilterCount} фильтров
                  </span>
                ) : null}
                {products.isFetching && !products.isLoading ? (
                  <p className="text-xs text-muted-foreground">Обновляем...</p>
                ) : null}
              </div>
              <AnimatePresence>
                {activeFilterCount > 0 && (
                  <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}>
                    <Button variant="ghost" size="sm" disabled={products.isFetching} onClick={clearFilters} className="gap-1.5 text-xs">
                      <X className="h-3 w-3" />
                      Сбросить фильтры
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {activeFilterChips.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-wrap gap-2"
              >
                {activeFilterChips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-accent/20 bg-accent/5 px-3 py-1 text-xs font-medium text-accent"
                  >
                    {chip}
                  </span>
                ))}
              </motion.div>
            )}
          </div>

          <CatalogGrid loading={products.isLoading} items={products.data?.items ?? []} />

          {showPagination ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2">
              <p className="text-sm text-muted-foreground">Страница {currentPage}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canGoPrevPage || products.isFetching}
                  onClick={() => goToPage(currentPage - 1)}
                >
                  Назад
                </Button>
                {pageButtons.map((page) => (
                  <Button
                    key={page}
                    variant={page === currentPage ? "default" : "outline"}
                    size="sm"
                    disabled={products.isFetching}
                    onClick={() => goToPage(page)}
                    className={page === currentPage ? "bg-accent text-white hover:bg-accent/90" : ""}
                  >
                    {page}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNextPage || products.isFetching}
                  onClick={() => goToPage(currentPage + 1)}
                >
                  Вперёд
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
