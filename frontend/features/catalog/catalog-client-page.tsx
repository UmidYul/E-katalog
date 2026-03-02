"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CatalogFilters, type FilterState } from "@/components/catalog/catalog-filters";
import { CatalogGrid } from "@/components/catalog/catalog-grid";
import { ErrorState } from "@/components/common/error-state";
import { SectionHeading } from "@/components/common/section-heading";
import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCatalogFiltersFromUrl } from "@/features/catalog/use-catalog-filters";
import { useBrands, useCatalogProducts, useDynamicFilters } from "@/features/catalog/use-catalog-queries";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { cn } from "@/lib/utils/cn";
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
  newest: "Сначала новые"
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

const getActiveFilterCount = (filters: FilterState) => {
  const attrCount = Object.values(filters.attrs ?? {}).reduce((acc, values) => acc + values.length, 0);
  const hasMinPrice = filters.minPrice !== undefined && filters.minPrice > PRICE_MIN;
  const hasMaxPrice = filters.maxPrice !== undefined && filters.maxPrice < PRICE_MAX;

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

export function CatalogClientPage({
  categoryId,
  presetBrandId,
  presetQuery,
  pageTitle
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

  const filters: FilterState = {
    q: fromUrl.q ?? presetQuery,
    sort: fromUrl.sort,
    minPrice: fromUrl.min_price,
    maxPrice: fromUrl.max_price,
    maxDeliveryDays: fromUrl.max_delivery_days,
    brands: mergeUnique([...(fromUrl.brand_id ?? []), ...(presetBrandId ? [presetBrandId] : [])]),
    stores: fromUrl.store_id ?? [],
    sellers: fromUrl.seller_id ?? [],
    attrs: fromUrl.attrs
  };
  const activeFilterCount = useMemo(() => getActiveFilterCount(filters), [filters]);

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
      limit: 24
    }),
    [categoryId, debounced, fromUrl.cursor, presetBrandId]
  );

  const products = useCatalogProducts(queryPayload);
  const brands = useBrands();
  const dynamicFilters = useDynamicFilters(categoryId);
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
      brands: mergeUnique([...(next.brands ?? []), ...(presetBrandId ? [presetBrandId] : [])])
    };
    const query = toQueryString(payload);
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };
  const clearFilters = () =>
    onFiltersChange({
      ...EMPTY_FILTERS,
      q: presetQuery,
      brands: presetBrandId ? [presetBrandId] : []
    });

  const goToPage = (targetPage: number) => {
    if (targetPage < 1 || targetPage === currentPage) return;

    const params = new URLSearchParams(searchParams.toString());
    if (targetPage === 1) {
      params.delete("page");
      params.delete("cursor");
    } else {
      const targetCursor =
        targetPage === currentPage + 1 ? (products.data?.next_cursor ?? cursorByPage[targetPage]) : cursorByPage[targetPage];
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
    <div className="container min-h-screen space-y-10 py-10">
      <header className="space-y-4">
        <Breadcrumbs items={[{ href: "/", label: "Главная" }, { href: "/catalog", label: "Каталог" }]} />
        <SectionHeading
          title={pageTitle ?? "Каталог товаров"}
          description="Агрегатор предложений от сотен магазинов с умной фильтрацией."
        />
      </header>

      <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
        <aside className="sticky top-24 h-fit space-y-6">
          <div className="rounded-[2rem] border border-border/50 bg-card p-6 shadow-xl">
            <CatalogFilters
              brands={brands.data ?? []}
              stores={dynamicFilters.data?.stores}
              sellers={dynamicFilters.data?.sellers}
              dynamicAttributes={dynamicFilters.data?.attributes}
              value={filters}
              onChange={onFiltersChange}
            />
          </div>
        </aside>

        <main className="space-y-8">
          <section className="flex flex-col gap-6 rounded-[2rem] border border-border/50 bg-card/50 p-6 backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-bold">
                  {products.data?.items.length ?? 0} товаров
                </Badge>
                {activeFilterCount > 0 && (
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 px-4 py-1.5 font-bold">
                    {activeFilterCount} фильтров
                  </Badge>
                )}
                {products.isFetching && !products.isLoading && (
                  <span className="flex items-center gap-2 text-xs font-bold text-muted-foreground animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Обновление...
                  </span>
                )}
              </div>

              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-xl text-xs font-bold text-muted-foreground hover:text-destructive transition-colors"
                  onClick={clearFilters}
                >
                  Сбросить всё
                </Button>
              )}
            </div>

            {activeFilterChips.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40">
                {activeFilterChips.map((chip) => (
                  <div
                    key={chip}
                    className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 text-xs font-bold border border-border/60 text-foreground/70"
                  >
                    {chip}
                  </div>
                ))}
              </div>
            )}
          </section>

          <CatalogGrid loading={products.isLoading} items={products.data?.items ?? []} />

          {showPagination && (
            <div className="flex items-center justify-center pt-8">
              <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-card p-2 shadow-lg">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl"
                  disabled={!canGoPrevPage || products.isFetching}
                  onClick={() => goToPage(currentPage - 1)}
                >
                  ←
                </Button>

                <div className="flex items-center gap-1 px-4">
                  {pageButtons.map((page) => (
                    <Button
                      key={page}
                      variant={page === currentPage ? "default" : "ghost"}
                      size="sm"
                      className={cn(
                        "rounded-xl font-bold min-w-[36px]",
                        page === currentPage ? "shadow-md shadow-primary/20" : "text-muted-foreground"
                      )}
                      disabled={products.isFetching}
                      onClick={() => goToPage(page)}
                    >
                      {page}
                    </Button>
                  ))}
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl"
                  disabled={!hasNextPage || products.isFetching}
                  onClick={() => goToPage(currentPage + 1)}
                >
                  →
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

