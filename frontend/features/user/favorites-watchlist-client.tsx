"use client";

import { useQueries } from "@tanstack/react-query";
import { Bell, Grid3X3, List } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ProductCard, ProductListRow } from "@/components/catalog/product-card";
import { EmptyState } from "@/components/common/empty-state";
import { PriceAlertModal } from "@/components/common/price-alert-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductGridSkeleton } from "@/components/catalog/catalog-grid";
import { useFavorites, useRemoveFavorite, useToggleFavorite, type FavoriteListItem } from "@/features/user/use-favorites";
import { useUserPriceAlerts } from "@/features/user/use-price-alerts";
import { catalogApi } from "@/lib/api/openapi-client";
import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/utils/format";
import { COMPARE_LIMIT, type CompareToggleResult, useCompareStore } from "@/store/compare.store";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import type { ProductDetail, ProductListItem, ProductOffer } from "@/types/domain";

type FavoritesSort = "added_desc" | "price_asc" | "discount_desc";
type FavoritesViewMode = "grid" | "list";

type FavoriteProductItem = {
  productId: string;
  favorite: FavoriteListItem;
  product: ProductListItem;
  offers: ProductOffer[];
  minPrice: number | null;
  priceChangePercent: number | null;
  alertEnabled: boolean;
  categoryLabel: string;
  slug: string;
};

const SORT_OPTIONS: Array<{ value: FavoritesSort; label: string }> = [
  { value: "added_desc", label: "Қўшилган сана бўйича" },
  { value: "price_asc", label: "Нарх бўйича" },
  { value: "discount_desc", label: "Чегирма бўйича" },
];

const normalizeText = (value: unknown) => String(value ?? "").trim();
const normalizeCategoryKey = (value: unknown) => normalizeText(value).toLowerCase();

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-");

const formatPriceWithSum = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) && value > 0 ? `${formatPrice(Math.round(value))} сўм` : "—";

const buildMinPrice = (detail: ProductDetail): number | null => {
  const prices = (detail.offers_by_store ?? [])
    .map((store) => Number(store.minimal_price ?? 0))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!prices.length) return null;
  return Math.round(Math.min(...prices));
};

const buildPriceDropPct = (detail: ProductDetail): number | undefined => {
  const values = (detail.offers_by_store ?? [])
    .flatMap((store) => store.offers ?? [])
    .map((offer) => {
      const oldPrice = Number(offer.old_price_amount ?? 0);
      const currentPrice = Number(offer.price_amount ?? 0);
      if (!Number.isFinite(oldPrice) || !Number.isFinite(currentPrice)) return 0;
      if (oldPrice <= 0 || currentPrice <= 0 || oldPrice <= currentPrice) return 0;
      return Math.round(((oldPrice - currentPrice) / oldPrice) * 100);
    })
    .filter((percent) => percent > 0);
  if (!values.length) return undefined;
  return Math.max(...values);
};

const toProductListItem = (productId: string, detail: ProductDetail, minPrice: number | null): ProductListItem => ({
  id: productId,
  normalized_title: normalizeText(detail.title) || productId,
  image_url: detail.main_image ?? undefined,
  min_price: minPrice,
  max_price: null,
  store_count: (detail.offers_by_store ?? []).length,
  in_stock: undefined,
  score: undefined,
  brand: detail.brand ? { id: "", name: detail.brand } : null,
  category: detail.category ? { id: "", name: detail.category } : null,
  is_new: undefined,
  discount_pct: undefined,
  price_drop_pct: buildPriceDropPct(detail),
});

const toFlattenOffers = (detail: ProductDetail): ProductOffer[] =>
  (detail.offers_by_store ?? []).flatMap((store) => store.offers ?? []).slice(0, 4);

const buildPriceChangePercent = (favorite: FavoriteListItem, minPrice: number | null): number | null => {
  if (favorite.price_drop_percent != null && Number.isFinite(favorite.price_drop_percent)) {
    return Number(favorite.price_drop_percent);
  }

  const savedPrice = Number(favorite.saved_price ?? 0);
  if (!savedPrice || !Number.isFinite(savedPrice) || !minPrice || !Number.isFinite(minPrice)) return null;
  const delta = minPrice - savedPrice;
  const absPercent = Math.round((Math.abs(delta) / savedPrice) * 100);
  if (delta < 0) return absPercent;
  if (delta > 0) return -absPercent;
  return 0;
};

export function FavoritesWatchlistClient() {
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const removeFavorite = useRemoveFavorite();

  const serverPriceAlerts = useUserPriceAlerts();
  const alertMetas = usePriceAlertsStore((s) => s.metas);
  const mergeServerMetas = usePriceAlertsStore((s) => s.mergeServerMetas);
  const ensureAlertMeta = usePriceAlertsStore((s) => s.ensureMeta);
  const setAlertsEnabled = usePriceAlertsStore((s) => s.setAlertsEnabled);
  const syncWithFavorites = usePriceAlertsStore((s) => s.syncWithFavorites);

  const compareItems = useCompareStore((s) => s.items);
  const compareAdd = useCompareStore((s) => s.add);
  const toggleCompare = useCompareStore((s) => s.toggle);

  const [sortBy, setSortBy] = useState<FavoritesSort>("added_desc");
  const [viewMode, setViewMode] = useState<FavoritesViewMode>("grid");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [alertModalItem, setAlertModalItem] = useState<FavoriteProductItem | null>(null);
  const holdTimersRef = useRef<Record<string, number>>({});

  const favoriteItems = favorites.data ?? [];
  const favoriteIds = useMemo(() => favoriteItems.map((item) => item.product_id), [favoriteItems]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("doxx_catalog_view");
      if (stored === "grid" || stored === "list") {
        setViewMode(stored);
      }
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

  useEffect(() => {
    if (!serverPriceAlerts.data?.length) return;
    mergeServerMetas(serverPriceAlerts.data);
  }, [mergeServerMetas, serverPriceAlerts.data]);

  useEffect(() => {
    syncWithFavorites(favoriteIds);
  }, [favoriteIds, syncWithFavorites]);

  useEffect(
    () => () => {
      Object.values(holdTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      holdTimersRef.current = {};
    },
    [],
  );

  const productQueries = useQueries({
    queries: favoriteIds.map((productId) => ({
      queryKey: ["catalog", "product", productId, "favorites-page"],
      queryFn: () => catalogApi.getProduct(productId),
      staleTime: 60_000,
    })),
  });

  const favoriteById = useMemo(
    () => new Map(favoriteItems.map((item) => [item.product_id, item])),
    [favoriteItems],
  );

  const items = useMemo<FavoriteProductItem[]>(() => {
    return favoriteIds.flatMap((productId, index) => {
      const query = productQueries[index];
      const detail = query?.data as ProductDetail | undefined;
      if (!detail) return [];

      const favorite = favoriteById.get(productId);
      if (!favorite) return [];

      const minPrice = buildMinPrice(detail);
      const product = toProductListItem(productId, detail, minPrice);
      const categoryLabel = normalizeText(product.category?.name) || "Бошқа";
      const alertEnabled = Boolean(alertMetas[productId]?.alerts_enabled || favorite.alerts_enabled);
      return [
        {
          productId,
          favorite,
          product,
          offers: toFlattenOffers(detail),
          minPrice,
          priceChangePercent: buildPriceChangePercent(favorite, minPrice),
          alertEnabled,
          categoryLabel,
          slug: `${productId}-${slugify(product.normalized_title)}`,
        },
      ];
    });
  }, [alertMetas, favoriteById, favoriteIds, productQueries]);

  useEffect(() => {
    items.forEach((item) => ensureAlertMeta(item.productId, item.minPrice));
  }, [ensureAlertMeta, items]);

  const categoryChips = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const item of items) {
      const key = normalizeCategoryKey(item.categoryLabel) || "other";
      const current = map.get(key);
      if (current) {
        current.count += 1;
      } else {
        map.set(key, { key, label: item.categoryLabel, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "uz-Cyrl"));
  }, [items]);

  const filteredItems = useMemo(() => {
    if (categoryFilter === "all") return items;
    return items.filter((item) => normalizeCategoryKey(item.categoryLabel) === categoryFilter);
  }, [categoryFilter, items]);

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    if (sortBy === "price_asc") {
      list.sort((a, b) => {
        const left = a.minPrice ?? Number.POSITIVE_INFINITY;
        const right = b.minPrice ?? Number.POSITIVE_INFINITY;
        return left - right;
      });
      return list;
    }
    if (sortBy === "discount_desc") {
      list.sort((a, b) => {
        const left = a.priceChangePercent ?? Number.NEGATIVE_INFINITY;
        const right = b.priceChangePercent ?? Number.NEGATIVE_INFINITY;
        return right - left;
      });
      return list;
    }
    list.sort((a, b) => {
      const left = a.favorite.added_at ? new Date(a.favorite.added_at).getTime() : 0;
      const right = b.favorite.added_at ? new Date(b.favorite.added_at).getTime() : 0;
      return right - left;
    });
    return list;
  }, [filteredItems, sortBy]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIds = useMemo(() => sortedItems.map((item) => item.productId), [sortedItems]);

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => favoriteById.has(id)));
  }, [favoriteById]);

  useEffect(() => {
    if (!selectedIds.length) setBulkMode(false);
  }, [selectedIds.length]);

  const referenceCompareCategory = useMemo(() => {
    for (const compareItem of compareItems) {
      const category = normalizeCategoryKey(compareItem.category);
      if (category) return category;
    }
    return undefined;
  }, [compareItems]);

  const activeAlertsCount = useMemo(
    () => items.filter((item) => Boolean(alertMetas[item.productId]?.alerts_enabled || item.alertEnabled)).length,
    [alertMetas, items],
  );

  const isLoadingProducts = productQueries.some((query) => query.isLoading || query.isFetching);

  const toggleSelected = (productId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = checked ? Array.from(new Set([...prev, productId])) : prev.filter((id) => id !== productId);
      if (next.length) setBulkMode(true);
      return next;
    });
  };

  const handleSelectAllVisible = (checked: boolean) => {
    if (!checked) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
      return;
    }
    setBulkMode(true);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const handleBulkCompare = () => {
    if (!selectedIds.length) return;
    let addedCount = 0;
    for (const productId of selectedIds) {
      const item = items.find((entry) => entry.productId === productId);
      if (!item) continue;

      const result: CompareToggleResult = compareAdd({
        id: item.productId,
        title: item.product.normalized_title,
        slug: item.slug,
        category: item.product.category?.name,
        image: item.product.image_url,
      });

      if (result === "added") {
        addedCount += 1;
        continue;
      }
      if (result === "limit_reached") {
        toast.error(`Энг кўпи ${COMPARE_LIMIT} та товар солиштириш мумкин.`);
        break;
      }
      if (result === "category_mismatch") {
        toast.error("Солиштириш фақат битта категория ичида ишлайди.");
        break;
      }
    }

    if (addedCount > 0) {
      toast.success(`${addedCount} та товар солиштиришга қўшилди.`);
    }
  };

  const handleBulkRemove = async () => {
    if (!selectedIds.length) return;
    const ids = [...selectedIds];
    for (const id of ids) {
      try {
        await removeFavorite.mutateAsync(id);
      } catch {
        // ignore individual remove errors
      }
    }
    setSelectedIds([]);
    setBulkMode(false);
  };

  const startLongPress = (productId: string) => () => {
    if (bulkMode) return;
    const timer = window.setTimeout(() => {
      setBulkMode(true);
      setSelectedIds((prev) => (prev.includes(productId) ? prev : [...prev, productId]));
    }, 450);
    holdTimersRef.current[productId] = timer;
  };

  const stopLongPress = (productId: string) => () => {
    const timer = holdTimersRef.current[productId];
    if (timer) {
      window.clearTimeout(timer);
      delete holdTimersRef.current[productId];
    }
  };

  if (favorites.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <ProductGridSkeleton count={6} mode={viewMode} />
      </div>
    );
  }

  if (favoriteItems.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <EmptyState
          icon={<span className="text-3xl">🤍</span>}
          title="Сараланганлар рўйхати бўш"
          description="Нарх тушишини кузатиш учун товарларни сараланганларга қўшинг — биз хабар берамиз"
          action={
            <Link href="/catalog" className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Каталогга ўтиш
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-2xl font-extrabold">Сараланганлар</h1>
        <Badge>{favoriteItems.length} та товар</Badge>
        <span className="flex-1" />

        <Select value={sortBy} onValueChange={(value) => setSortBy(value as FavoritesSort)}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Саралаш" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="inline-flex items-center rounded-lg border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={cn("rounded-lg px-3 py-1.5", viewMode === "grid" ? "bg-accent text-white" : "text-muted-foreground")}
            aria-label="Катакча кўриниш"
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={cn("rounded-lg px-3 py-1.5", viewMode === "list" ? "bg-accent text-white" : "text-muted-foreground")}
            aria-label="Рўйхат кўриниш"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {activeAlertsCount > 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Сиз {activeAlertsCount} та товар нархини кузатмоқдасиз
        </div>
      ) : null}

      {items.length > 8 ? (
        <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
              categoryFilter === "all" ? "border-accent bg-accent text-white" : "border-border bg-card text-foreground",
            )}
          >
            Барчаси ({items.length})
          </button>
          {categoryChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setCategoryFilter(chip.key)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
                categoryFilter === chip.key ? "border-accent bg-accent text-white" : "border-border bg-card text-foreground",
              )}
            >
              {chip.label} ({chip.count})
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(event) => handleSelectAllVisible(event.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Ҳаммасини танлаш
        </label>

        <Button
          size="sm"
          variant="outline"
          onClick={handleBulkCompare}
          disabled={!selectedIds.length}
        >
          Танланганларни солиштириш
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleBulkRemove}
          disabled={!selectedIds.length || removeFavorite.isPending}
        >
          Танланганларни ўчириш
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {bulkMode ? `${selectedIds.length} та танланди` : "Мобилда узоқ босиб bulk режимни ёқинг"}
        </span>
      </div>

      {isLoadingProducts && !items.length ? (
        <ProductGridSkeleton count={6} mode={viewMode} />
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedItems.map((item) => {
            const inCompare = compareItems.some((entry) => entry.id === item.productId);
            const normalizedCategory = normalizeCategoryKey(item.product.category?.name);
            const categoryMismatch =
              Boolean(referenceCompareCategory && normalizedCategory && referenceCompareCategory !== normalizedCategory);
            const compareDisabled =
              !inCompare && (compareItems.length >= COMPARE_LIMIT || categoryMismatch);

            return (
              <div
                key={item.productId}
                className="space-y-2"
                onTouchStart={startLongPress(item.productId)}
                onTouchEnd={stopLongPress(item.productId)}
                onTouchCancel={stopLongPress(item.productId)}
              >
                <ProductCard
                  product={item.product}
                  favorite
                  onFavorite={() => toggleFavorite.mutate(item.productId)}
                  compared={inCompare}
                  compareDisabled={compareDisabled}
                  compareDisabledReason={compareDisabled ? "Фақат битта категория ва максимум 4 товар" : undefined}
                  onCompare={() =>
                    toggleCompare({
                      id: item.productId,
                      title: item.product.normalized_title,
                      slug: item.slug,
                      category: item.product.category?.name,
                      image: item.product.image_url,
                    })
                  }
                />

                <div className="rounded-xl border border-border bg-card p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {item.priceChangePercent != null ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-xs font-semibold",
                          item.priceChangePercent > 0 && "bg-emerald-100 text-emerald-700",
                          item.priceChangePercent < 0 && "bg-rose-100 text-rose-700",
                          item.priceChangePercent === 0 && "bg-secondary text-muted-foreground",
                        )}
                      >
                        {item.priceChangePercent > 0
                          ? `↓ ${item.priceChangePercent}% қўшилгандан бери`
                          : item.priceChangePercent < 0
                            ? `↑ ${Math.abs(item.priceChangePercent)}% қўшилгандан бери`
                            : "Нарх ўзгармади"}
                      </span>
                    ) : null}
                    {item.alertEnabled ? (
                      <Badge className="border-accent/40 bg-accent/10 text-accent">
                        🔔 Огоҳлантириш ёқилган
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={item.alertEnabled ? "default" : "outline"}
                      onClick={() => setAlertModalItem(item)}
                    >
                      <Bell className="mr-1.5 h-3.5 w-3.5" />
                      {item.alertEnabled ? "Нархни кузатяпман" : "Нарх пасайса хабар беринг"}
                    </Button>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(item.productId)}
                        onChange={(event) => toggleSelected(item.productId, event.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      Танлаш
                    </label>
                    <span className="ml-auto text-xs text-muted-foreground">
                      Қўшилган нарх: {formatPriceWithSum(item.favorite.saved_price)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedItems.map((item) => {
            const inCompare = compareItems.some((entry) => entry.id === item.productId);
            const normalizedCategory = normalizeCategoryKey(item.product.category?.name);
            const categoryMismatch =
              Boolean(referenceCompareCategory && normalizedCategory && referenceCompareCategory !== normalizedCategory);
            const compareDisabled =
              !inCompare && (compareItems.length >= COMPARE_LIMIT || categoryMismatch);

            return (
              <div
                key={item.productId}
                className="space-y-2"
                onTouchStart={startLongPress(item.productId)}
                onTouchEnd={stopLongPress(item.productId)}
                onTouchCancel={stopLongPress(item.productId)}
              >
                <ProductListRow
                  product={item.product}
                  favorite
                  onFavorite={() => toggleFavorite.mutate(item.productId)}
                  compared={inCompare}
                  compareDisabled={compareDisabled}
                  compareDisabledReason={compareDisabled ? "Фақат битта категория ва максимум 4 товар" : undefined}
                  onCompare={() =>
                    toggleCompare({
                      id: item.productId,
                      title: item.product.normalized_title,
                      slug: item.slug,
                      category: item.product.category?.name,
                      image: item.product.image_url,
                    })
                  }
                  offers={item.offers}
                />

                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                  {item.priceChangePercent != null ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-xs font-semibold",
                        item.priceChangePercent > 0 && "bg-emerald-100 text-emerald-700",
                        item.priceChangePercent < 0 && "bg-rose-100 text-rose-700",
                        item.priceChangePercent === 0 && "bg-secondary text-muted-foreground",
                      )}
                    >
                      {item.priceChangePercent > 0
                        ? `↓ ${item.priceChangePercent}% қўшилгандан бери`
                        : item.priceChangePercent < 0
                          ? `↑ ${Math.abs(item.priceChangePercent)}% қўшилгандан бери`
                          : "Нарх ўзгармади"}
                    </span>
                  ) : null}
                  {item.alertEnabled ? (
                    <Badge className="border-accent/40 bg-accent/10 text-accent">
                      🔔 Огоҳлантириш ёқилган
                    </Badge>
                  ) : null}

                  <Button
                    size="sm"
                    variant={item.alertEnabled ? "default" : "outline"}
                    onClick={() => setAlertModalItem(item)}
                  >
                    <Bell className="mr-1.5 h-3.5 w-3.5" />
                    {item.alertEnabled ? "Нархни кузатяпман" : "Нарх пасайса хабар беринг"}
                  </Button>

                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(item.productId)}
                      onChange={(event) => toggleSelected(item.productId, event.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    Танлаш
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PriceAlertModal
        open={Boolean(alertModalItem)}
        onOpenChange={(open) => {
          if (!open) setAlertModalItem(null);
        }}
        productId={alertModalItem?.productId ?? ""}
        currentPrice={alertModalItem?.minPrice ?? null}
        onSuccess={() => {
          if (!alertModalItem) return;
          setAlertsEnabled(alertModalItem.productId, true, alertModalItem.minPrice);
        }}
      />
    </div>
  );
}
