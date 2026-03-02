"use client";

import { useEffect, useMemo } from "react";

import { ProductCard } from "@/components/catalog/product-card";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { buildPriceAlertSignal, toPositivePriceOrNull } from "@/lib/utils/price-alerts";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import type { ProductListItem } from "@/types/domain";

export function CatalogGrid({ loading, items }: { loading: boolean; items: ProductListItem[] }) {
  const { data: favorites } = useFavorites();
  const toggle = useToggleFavorite();
  const compareItems = useCompareStore((s) => s.items);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const alertMetas = usePriceAlertsStore((s) => s.metas);
  const ensureAlertMeta = usePriceAlertsStore((s) => s.ensureMeta);

  const favoriteSet = useMemo(() => new Set((favorites ?? []).map((x) => x.product_id)), [favorites]);

  useEffect(() => {
    items.forEach((item) => {
      if (!favoriteSet.has(item.id)) return;
      ensureAlertMeta(item.id, toPositivePriceOrNull(item.min_price));
    });
  }, [ensureAlertMeta, favoriteSet, items]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, idx) => (
          <Skeleton key={idx} className="h-[360px]" />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return <EmptyState title="Товары не найдены" message="Попробуйте изменить фильтры или поисковый запрос." />;
  }

  const compareSet = new Set(compareItems.map((item) => item.id));
  const compareFull = compareItems.length >= COMPARE_LIMIT;
  const referenceCompareCategory = getReferenceCategory(compareItems.map((item) => item.category));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const inCompare = compareSet.has(item.id);
        const categoryMismatch = Boolean(referenceCompareCategory && normalizeCategory(item.category?.name) && normalizeCategory(item.category?.name) !== referenceCompareCategory);
        const compareDisabled = !inCompare && (compareFull || categoryMismatch);
        const compareDisabledReason = compareFull ? `Лимит: ${COMPARE_LIMIT} товара` : categoryMismatch ? "Можно сравнивать только внутри одной категории" : undefined;
        const isTracking = favoriteSet.has(item.id);
        const alertMeta = alertMetas[item.id];
        const signal = isTracking && alertMeta?.alerts_enabled ? buildPriceAlertSignal(alertMeta, toPositivePriceOrNull(item.min_price)) : null;

        return (
          <ProductCard
            key={item.id}
            product={item}
            favorite={isTracking}
            onFavorite={(id) => toggle.mutate(id)}
            compared={inCompare}
            compareDisabled={compareDisabled}
            compareDisabledReason={compareDisabledReason}
            priceAlertSignal={signal}
            onCompare={(id) =>
              toggleCompare({
                id,
                title: item.normalized_title,
                slug: `${item.id}-${slugify(item.normalized_title)}`,
                category: item.category?.name
              })
            }
          />
        );
      })}
    </div>
  );
}

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

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
