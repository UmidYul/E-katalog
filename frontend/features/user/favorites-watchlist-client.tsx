"use client";

import { motion } from "framer-motion";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/components/common/locale-provider";
import { PriceAlertBadge } from "@/components/common/price-alert-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { useDeleteUserPriceAlert, useUpsertUserPriceAlert, useUserPriceAlerts } from "@/features/user/use-price-alerts";
import { catalogApi } from "@/lib/api/openapi-client";
import { formatPrice } from "@/lib/utils/format";
import { buildPriceAlertSignal, toPositivePriceOrNull } from "@/lib/utils/price-alerts";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import type { WatchlistFilter } from "@/types/domain";

export function FavoritesWatchlistClient() {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);
  const storesCountLabel = (count: number) => (isUz ? `${count} та дўкон` : `${count} магазинов`);
  const offersCountLabel = (count: number) => (isUz ? `${count} та таклиф` : `${count} предложений`);

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
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <h1 className="font-heading text-2xl font-extrabold">{tr("Избранное", "Сараланганлар")}</h1>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-extrabold">{tr("Избранное", "Сараланганлар")}</h1>
        <Badge>{tr(`${favoriteIds.length} сохранено`, `${favoriteIds.length} та сақланган`)}</Badge>
      </div>

      {(favorites.data?.length ?? 0) === 0 ? (
        <EmptyState
          title={tr("Избранное пока пустое", "Сараланганлар ҳозирча бўш")}
          message={tr("Сохраняйте товары, чтобы вернуться к ним позже и включить отслеживание цены.", "Кейинроқ қайтиш ва нархни кузатиш учун товарларни сақланг.")}
        />
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="font-heading text-lg font-extrabold">{tr("Отслеживание цен", "Нарх кузатуви")}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-warning/40 bg-warning/15 text-warning">{tr("Снижений", "Пасайишлар")}: {watchlistDropCount}</Badge>
                  <Badge className="border-success/40 bg-success/15 text-success">{tr("Целей достигнуто", "Мақсадга етган")}: {watchlistTargetCount}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={watchlistFilter === "all" ? "default" : "outline"} onClick={() => setWatchlistFilter("all")}>
                  {tr("Все", "Барчаси")}
                </Button>
                <Button size="sm" variant={watchlistFilter === "drop" ? "default" : "outline"} onClick={() => setWatchlistFilter("drop")}>
                  {tr("Есть снижение", "Пасайиш бор")}
                </Button>
                <Button size="sm" variant={watchlistFilter === "target_hit" ? "default" : "outline"} onClick={() => setWatchlistFilter("target_hit")}>
                  {tr("Достигли цели", "Мақсадга етган")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!filteredWatchlistItems.length ? (
                <p className="text-sm text-muted-foreground">{tr("Для выбранного фильтра пока нет подходящих товаров.", "Танланган фильтр учун мос товарлар ҳозирча йўқ.")}</p>
              ) : (
                <div className="space-y-3">
                  {filteredWatchlistItems.map((item) => {
                    const productSlug = `${item.id}-${slugify(item.data.title)}`;
                    return (
                      <div key={item.id} className="rounded-xl border border-border/80 bg-background/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <Link href={`/product/${productSlug}`} className="line-clamp-1 text-sm font-semibold text-accent hover:underline">
                              {item.data.title}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {tr("Текущая цена", "Жорий нарх")}: {item.minPrice != null ? formatPrice(item.minPrice) : tr("нет данных", "маълумот йўқ")}
                            </p>
                          </div>
                          <PriceAlertBadge signal={item.signal} />
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,220px)_auto_auto_auto] sm:items-end">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">{tr("Целевая цена (UZS)", "Мақсад нархи (UZS)")}</label>
                            <Input
                              value={targetDrafts[item.id] ?? ""}
                              onChange={(event) => setTargetDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                              placeholder={tr("Например: 12000000", "Масалан: 12000000")}
                            />
                          </div>
                          <Button size="sm" variant="outline" onClick={() => saveTarget(item.id)}>
                            {tr("Сохранить цель", "Мақсадни сақлаш")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleResetBaseline(item.id, item.minPrice)}>
                            {tr("Обновить базу", "Базани янгилаш")}
                          </Button>
                          <Button
                            size="sm"
                            variant={item.meta?.alerts_enabled ? "default" : "outline"}
                            onClick={() => handleToggleAlertsEnabled(item.id, !Boolean(item.meta?.alerts_enabled), item.minPrice)}
                          >
                            {item.meta?.alerts_enabled ? tr("Алерт включён", "Алерт ёқилган") : tr("Включить алерт", "Алертни ёқиш")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {isLoadingProducts && !products.length ? <p className="mb-3 text-sm text-muted-foreground">{tr("Загружаем товары из избранного...", "Сараланган товарлар юкланмоқда...")}</p> : null}

          <div className="space-y-3">
            {products.map(({ id, data }) => {
              const minPrice = data.offers_by_store.reduce((acc, store) => Math.min(acc, store.minimal_price), Number.POSITIVE_INFINITY);
              const offersCount = data.offers_by_store.reduce((acc, store) => acc + store.offers_count, 0);
              const productSlug = `${id}-${slugify(data.title)}`;
              const inCompare = compareSet.has(id);
              const categoryMismatch = Boolean(referenceCompareCategory && normalizeCategory(data.category) && normalizeCategory(data.category) !== referenceCompareCategory);
              const compareDisabled = !inCompare && (compareFull || categoryMismatch);
              const compareDisabledReason = compareFull
                ? tr(`Лимит: ${COMPARE_LIMIT} товара`, `Лимит: ${COMPARE_LIMIT} та товар`)
                : categoryMismatch
                  ? tr("Сравнение доступно только в одной категории", "Солиштириш фақат битта категорияда мумкин")
                  : undefined;
              return (
                <Card key={id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="space-y-1">
                      <Link href={`/product/${productSlug}`} className="text-sm font-semibold text-accent hover:underline">
                        {data.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {data.brand ? `${data.brand} · ` : ""}
                        {data.category}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {Number.isFinite(minPrice) ? <Badge className="bg-secondary/80">{formatPrice(minPrice)}</Badge> : null}
                        <Badge>{storesCountLabel(data.offers_by_store.length)}</Badge>
                        <Badge>{offersCountLabel(offersCount)}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/product/${productSlug}`}>
                        <Button variant="outline" size="sm">
                          {tr("Открыть", "Очиш")}
                        </Button>
                      </Link>
                      <Button
                        variant={inCompare ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          toggleCompare({
                            id,
                            title: data.title,
                            slug: productSlug,
                            category: data.category
                          })
                        }
                        disabled={compareDisabled}
                        title={compareDisabled ? compareDisabledReason : undefined}
                      >
                        {inCompare ? tr("В сравнении", "Солиштиришда") : tr("Сравнить", "Солиштириш")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveFavorite(id)}
                        disabled={toggleFavorite.isPending}
                      >
                        {tr("Убрать", "Олиб ташлаш")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {failedIds.map((id) => (
              <Card key={id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <p className="text-sm text-muted-foreground">{tr(`Товар #${id} недоступен.`, `#${id} товар мавжуд эмас.`)}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFavorite(id)}
                    disabled={toggleFavorite.isPending}
                  >
                    {tr("Убрать", "Олиб ташлаш")}
                  </Button>
                </CardContent>
              </Card>
            ))}

            {unresolvedIds.map((id) => (
              <Card key={id}>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">{tr(`Загружаем товар #${id}...`, `#${id} товар юкланмоқда...`)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
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
