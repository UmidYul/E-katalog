"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PriceAlertBadge } from "@/components/common/price-alert-badge";
import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { useDeleteUserPriceAlert, useUpsertUserPriceAlert, useUserPriceAlerts } from "@/features/user/use-price-alerts";
import { catalogApi } from "@/lib/api/openapi-client";
import { formatPrice } from "@/lib/utils/format";
import { buildPriceAlertSignal, toPositivePriceOrNull } from "@/lib/utils/price-alerts";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import type { WatchlistFilter } from "@/types/domain";

export function FavoritesWatchlistClient() {
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const serverPriceAlerts = useUserPriceAlerts();
  const upsertPriceAlert = useUpsertUserPriceAlert();
  const deletePriceAlert = useDeleteUserPriceAlert();
  const compareItems = useCompareStore((s) => s.items);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const alertMetas = usePriceAlertsStore((s) => s.metas);
  const mergeServerMetas = usePriceAlertsStore((s) => s.mergeServerMetas);
  const ensureAlertMeta = usePriceAlertsStore((s) => s.ensureMeta);
  const setAlertsEnabled = usePriceAlertsStore((s) => s.setAlertsEnabled);
  const setTargetPrice = usePriceAlertsStore((s) => s.setTargetPrice);
  const resetBaseline = usePriceAlertsStore((s) => s.resetBaseline);
  const updateLastSeen = usePriceAlertsStore((s) => s.updateLastSeen);
  const removeAlertMeta = usePriceAlertsStore((s) => s.removeMeta);
  const syncWithFavorites = usePriceAlertsStore((s) => s.syncWithFavorites);
  const [watchlistFilter, setWatchlistFilter] = useState<WatchlistFilter>("all");
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});

  const compareSet = useMemo(() => new Set(compareItems.map((item) => item.id)), [compareItems]);
  const compareFull = compareItems.length >= COMPARE_LIMIT;
  const referenceCompareCategory = useMemo(() => getReferenceCategory(compareItems.map((item) => item.category)), [compareItems]);
  const favoriteIds = useMemo(() => (favorites.data ?? []).map((item) => item.product_id), [favorites.data]);
  const serverAlertByProductId = useMemo(() => {
    const map = new Map<string, { id: string }>();
    for (const alert of serverPriceAlerts.data ?? []) {
      if (!alert?.product_id || !alert?.id) continue;
      map.set(alert.product_id, { id: alert.id });
    }
    return map;
  }, [serverPriceAlerts.data]);

  const productQueries = useQueries({
    queries: favoriteIds.map((productId) => ({
      queryKey: ["catalog", "product", productId, "favorites-watchlist"],
      queryFn: () => catalogApi.getProduct(productId),
      staleTime: 60_000
    }))
  });

  const favoriteQueryItems = useMemo(
    () =>
      productQueries.flatMap((query, index) => {
        const id = favoriteIds[index];
        if (typeof id !== "string") return [];
        return [{ id, data: query.data, error: query.error }] as const;
      }),
    [favoriteIds, productQueries]
  );

  const products = useMemo(
    () =>
      favoriteQueryItems.flatMap((item) => {
        if (!item.data) return [];
        return [{ id: item.id, data: item.data }];
      }),
    [favoriteQueryItems]
  );

  const unresolvedIds = useMemo(
    () =>
      favoriteQueryItems
        .filter((item) => !item.data && !item.error)
        .map((item) => item.id),
    [favoriteQueryItems]
  );

  const failedIds = useMemo(
    () =>
      favoriteQueryItems
        .filter((item) => !item.data && item.error)
        .map((item) => item.id),
    [favoriteQueryItems]
  );

  const isLoadingProducts = productQueries.some((query) => query.isLoading || query.isFetching);

  useEffect(() => {
    syncWithFavorites(favoriteIds);
  }, [favoriteIds, syncWithFavorites]);

  useEffect(() => {
    if (!serverPriceAlerts.data?.length) return;
    mergeServerMetas(serverPriceAlerts.data);
  }, [mergeServerMetas, serverPriceAlerts.data]);

  useEffect(() => {
    products.forEach(({ id, data }) => {
      const minPrice = toPositivePriceOrNull(data.offers_by_store.reduce((acc, store) => Math.min(acc, store.minimal_price), Number.POSITIVE_INFINITY));
      ensureAlertMeta(id, minPrice);
      updateLastSeen(id, minPrice);
    });
  }, [ensureAlertMeta, products, updateLastSeen]);

  const watchlistItems = useMemo(
    () =>
      products.map(({ id, data }) => {
        const minPrice = toPositivePriceOrNull(data.offers_by_store.reduce((acc, store) => Math.min(acc, store.minimal_price), Number.POSITIVE_INFINITY));
        const meta = alertMetas[id];
        const signal = meta ? buildPriceAlertSignal(meta, minPrice) : null;
        return { id, data, minPrice, meta, signal };
      }),
    [alertMetas, products]
  );

  useEffect(() => {
    setTargetDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      watchlistItems.forEach((item) => {
        const persisted = item.meta?.target_price != null ? String(Math.round(item.meta.target_price)) : "";
        if (next[item.id] === undefined) {
          next[item.id] = persisted;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [watchlistItems]);

  const filteredWatchlistItems = useMemo(() => {
    if (watchlistFilter === "drop") return watchlistItems.filter((item) => Boolean(item.signal?.is_drop));
    if (watchlistFilter === "target_hit") return watchlistItems.filter((item) => Boolean(item.signal?.is_target_hit));
    return watchlistItems;
  }, [watchlistFilter, watchlistItems]);

  const watchlistDropCount = useMemo(() => watchlistItems.filter((item) => item.signal?.is_drop).length, [watchlistItems]);
  const watchlistTargetCount = useMemo(() => watchlistItems.filter((item) => item.signal?.is_target_hit).length, [watchlistItems]);

  const saveTarget = (productId: string) => {
    const raw = targetDrafts[productId] ?? "";
    if (!raw.trim()) {
      setTargetPrice(productId, null);
      void upsertPriceAlert
        .mutateAsync({
          productId,
          target_price: null,
          channel: "telegram",
        })
        .catch(() => undefined);
      return;
    }
    const numeric = Number(raw.replace(/\s+/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setTargetPrice(productId, numeric);
    void upsertPriceAlert
      .mutateAsync({
        productId,
        target_price: numeric,
        channel: "telegram",
      })
      .catch(() => undefined);
  };

  const handleResetBaseline = (productId: string, minPrice: number | null) => {
    resetBaseline(productId, minPrice);
    void upsertPriceAlert
      .mutateAsync({
        productId,
        baseline_price: minPrice,
        current_price: minPrice,
        channel: "telegram",
      })
      .catch(() => undefined);
  };

  const handleToggleAlertsEnabled = (productId: string, enabled: boolean, minPrice: number | null) => {
    setAlertsEnabled(productId, enabled, minPrice);
    void upsertPriceAlert
      .mutateAsync({
        productId,
        alerts_enabled: enabled,
        current_price: minPrice,
        channel: "telegram",
      })
      .catch(() => undefined);
  };

  const handleRemoveFavorite = (productId: string) => {
    removeAlertMeta(productId);
    const serverAlert = serverAlertByProductId.get(productId);
    if (serverAlert?.id) {
      void deletePriceAlert.mutateAsync(serverAlert.id).catch(() => undefined);
    }
    toggleFavorite.mutate(productId);
  };

  if (favorites.isLoading) {
    return (
      <div className="container space-y-8 py-12">
        <Skeleton className="h-12 w-64 rounded-xl" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-[2.5rem]" />
          <Skeleton className="h-64 w-full rounded-[2.5rem]" />
        </div>
      </div>
    );
  }

  return (
    <div className="container min-h-screen space-y-12 py-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-4">
          <Breadcrumbs items={[{ href: "/", label: "Главная" }, { href: "/favorites", label: "Избранное" }]} />
          <div className="flex items-center gap-4">
            <h1 className="font-heading text-4xl font-[900] tracking-tighter">Избранное</h1>
            <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-black rounded-full">
              {favoriteIds.length} сохраненных
            </Badge>
          </div>
          <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest leading-none">Price Radar & Watchlist</p>
        </div>
      </header>

      {(favorites.data?.length ?? 0) === 0 ? (
        <section className="flex flex-col items-center justify-center rounded-[3rem] border border-dashed border-border/60 bg-secondary/10 p-20 text-center">
          <EmptyState
            title="Здесь пока пусто"
            message="Сохраняйте товары из каталога, чтобы отслеживать изменение цен и получать уведомления о скидках."
          />
          <Link href="/catalog" className="mt-8">
            <Button className="h-14 rounded-2xl px-10 text-base font-bold shadow-xl shadow-primary/20">Исследовать каталог</Button>
          </Link>
        </section>
      ) : (
        <>
          <section className="relative overflow-hidden rounded-[2.5rem] border border-border/50 bg-card p-1 shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/[0.03] to-secondary/10 pointer-events-none" />
            <div className="relative p-8 space-y-8">
              <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-6">
                <div className="space-y-1">
                  <h2 className="text-2xl font-black italic tracking-tight">Active Radar</h2>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Отслеживание актуальных цен</p>
                </div>
                <div className="flex flex-wrap gap-2 p-1.5 bg-secondary/30 rounded-2xl">
                  {[
                    { id: "all", label: "Все товары", count: watchlistItems.length },
                    { id: "drop", label: "Снижение", count: watchlistDropCount, color: "text-emerald-600 bg-emerald-500/10" },
                    { id: "target_hit", label: "Цель", count: watchlistTargetCount, color: "text-amber-600 bg-amber-500/10" }
                  ].map((btn) => (
                    <Button
                      key={btn.id}
                      size="sm"
                      variant={watchlistFilter === btn.id ? "default" : "ghost"}
                      onClick={() => setWatchlistFilter(btn.id as any)}
                      className={cn(
                        "rounded-xl font-bold transition-all px-4",
                        watchlistFilter === btn.id ? "shadow-lg" : "text-muted-foreground hover:bg-white/50"
                      )}
                    >
                      <span className="mr-2">{btn.label}</span>
                      <span className={cn(
                        "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black",
                        watchlistFilter === btn.id ? "bg-white/20" : btn.color || "bg-secondary/80"
                      )}>
                        {btn.count}
                      </span>
                    </Button>
                  ))}
                </div>
              </header>

              {!filteredWatchlistItems.length ? (
                <div className="py-12 text-center text-muted-foreground font-medium">Для данного фильтра пока нет активных радаров.</div>
              ) : (
                <div className="grid gap-4">
                  {filteredWatchlistItems.map((item) => {
                    const productSlug = `${item.id}-${slugify(item.data.title)}`;
                    return (
                      <div key={item.id} className="group relative overflow-hidden rounded-3xl border border-border/40 bg-secondary/20 p-6 transition-all hover:bg-secondary/40">
                        <div className="grid gap-8 lg:grid-cols-[1fr_auto]">
                          <div className="flex gap-6">
                            <div className="relative h-20 w-20 flex-shrink-0 animate-in fade-in zoom-in duration-500">
                              <Link href={`/product/${productSlug}`}>
                                <div className="h-full w-full rounded-2xl bg-white p-2 shadow-sm border border-border/20">
                                  {/* Product Image could be added here if available */}
                                  <div className="flex h-full items-center justify-center text-[10px] font-black text-muted-foreground/30 uppercase">Image</div>
                                </div>
                              </Link>
                            </div>
                            <div className="space-y-2">
                              <Link href={`/product/${productSlug}`} className="block text-lg font-black leading-tight hover:text-primary transition-colors">
                                {item.data.title}
                              </Link>
                              <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
                                <span>Текущая: <span className="font-black text-foreground">{item.minPrice != null ? formatPrice(item.minPrice) : "—"}</span></span>
                                <div className="h-1 w-1 rounded-full bg-border" />
                                <PriceAlertBadge signal={item.signal} />
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-4 lg:justify-end">
                            <div className="flex-1 lg:flex-none relative max-w-[200px]">
                              <Input
                                value={targetDrafts[item.id] ?? ""}
                                onChange={(event) => setTargetDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                                placeholder="Целевая цена..."
                                className="h-12 rounded-2xl border-none bg-white shadow-inner pl-4 pr-10 font-bold text-sm"
                              />
                              <button
                                onClick={() => saveTarget(item.id)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-primary hover:scale-110 active:scale-95 transition-all text-sm font-black"
                              >
                                ✔
                              </button>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResetBaseline(item.id, item.minPrice)}
                              className="h-12 rounded-2xl font-bold border-2"
                            >
                              Сбросить базу
                            </Button>
                            <Button
                              size="sm"
                              variant={item.meta?.alerts_enabled ? "default" : "outline"}
                              className={cn(
                                "h-12 rounded-2xl font-black transition-all",
                                item.meta?.alerts_enabled ? "shadow-lg shadow-primary/20" : "border-2"
                              )}
                              onClick={() => handleToggleAlertsEnabled(item.id, !Boolean(item.meta?.alerts_enabled), item.minPrice)}
                            >
                              {item.meta?.alerts_enabled ? "🔔 On" : "🔕 Off"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {isLoadingProducts && !products.length ? (
            <div className="flex items-center justify-center p-12">
              <div className="h-10 w-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : null}

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map(({ id, data }) => {
              const minPrice = data.offers_by_store.reduce((acc, store) => Math.min(acc, store.minimal_price), Number.POSITIVE_INFINITY);
              const offersCount = data.offers_by_store.reduce((acc, store) => acc + store.offers_count, 0);
              const productSlug = `${id}-${slugify(data.title)}`;
              const inCompare = compareSet.has(id);
              const categoryMismatch = Boolean(referenceCompareCategory && normalizeCategory(data.category) && normalizeCategory(data.category) !== referenceCompareCategory);
              const compareDisabled = !inCompare && (compareFull || categoryMismatch);
              const compareDisabledReason = compareFull ? `Лимит: ${COMPARE_LIMIT}` : categoryMismatch ? "Другая категория" : undefined;

              return (
                <div key={id} className="group relative overflow-hidden rounded-[2.5rem] border border-border/50 bg-card p-6 shadow-soft transition-all hover:shadow-2xl hover:shadow-primary/10">
                  <div className="space-y-6">
                    <div className="relative aspect-square overflow-hidden rounded-3xl bg-secondary/20 p-6 transition-transform group-hover:scale-[1.03] duration-500">
                      {/* Image Placeholder */}
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase text-muted-foreground/30">Preview</div>
                      <button
                        onClick={() => handleRemoveFavorite(id)}
                        disabled={toggleFavorite.isPending}
                        className="absolute right-4 top-4 h-10 w-10 rounded-2xl bg-white shadow-lg flex items-center justify-center text-sm transition-all hover:bg-destructive hover:text-white active:scale-95"
                      >
                        ×
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Link href={`/product/${productSlug}`} className="block text-base font-black leading-tight hover:text-primary transition-colors line-clamp-2 min-h-[44px]">
                          {data.title}
                        </Link>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none">
                          {data.brand || "Original"}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-border/40">
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-black uppercase text-muted-foreground/60 leading-none">Лучшая цена</p>
                          <p className="text-lg font-black italic">{Number.isFinite(minPrice) ? formatPrice(minPrice) : "N/A"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black uppercase text-muted-foreground/60 leading-none">{data.offers_by_store.length} Магазинов</p>
                          <p className="text-xs font-bold">{offersCount} Предложений</p>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <Link href={`/product/${productSlug}`} className="flex-1">
                          <Button className="w-full h-11 rounded-2xl font-black bg-primary/10 text-primary border-none hover:bg-primary hover:text-white transition-all">Открыть</Button>
                        </Link>
                        <Button
                          variant={inCompare ? "default" : "outline"}
                          className={cn(
                            "h-11 w-11 rounded-2xl border-2 p-0 flex items-center justify-center transition-all",
                            inCompare ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" : ""
                          )}
                          onClick={() =>
                            toggleCompare({
                              id,
                              title: data.title,
                              slug: productSlug,
                              category: data.category
                            })
                          }
                          disabled={compareDisabled}
                          title={compareDisabled ? compareDisabledReason : "Сравнить"}
                        >
                          ⚖
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {(failedIds.length > 0 || unresolvedIds.length > 0) && (
            <div className="mt-12 flex flex-wrap gap-4">
              {failedIds.map((id) => (
                <div key={id} className="flex items-center gap-4 rounded-2xl bg-destructive/10 px-6 py-4 border border-destructive/20">
                  <p className="text-sm font-bold text-destructive">Товар #{id.slice(0, 8)} недоступен</p>
                  <Button variant="ghost" size="sm" onClick={() => handleRemoveFavorite(id)} className="h-8 rounded-lg">×</Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const normalizeCategory = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
};

const getReferenceCategory = (categories: Array<string | undefined>) => {
  for (const category of categories) {
    const normalized = normalizeCategory(category);
    if (normalized) return normalized;
  }
  return undefined;
};
