"use client";

import { useQueries } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo } from "react";

import { ProductCard, ProductListRow } from "@/components/catalog/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { catalogApi } from "@/lib/api/openapi-client";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import type { ProductListItem, ProductOffer } from "@/types/domain";

export type CatalogViewMode = "grid" | "list";

export function ProductGridSkeleton({ count = 12, mode = "grid" }: { count?: number; mode?: CatalogViewMode }) {
  if (mode === "list") {
    return (
      <div className="space-y-3">
        {Array.from({ length: Math.max(6, Math.ceil(count / 2)) }).map((_, index) => (
          <Skeleton key={index} className="h-[180px] rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-[360px] rounded-2xl" />
      ))}
    </div>
  );
}

export function CatalogGrid({
  loading,
  items,
  viewMode,
}: {
  loading: boolean;
  items: ProductListItem[];
  viewMode: CatalogViewMode;
}) {
  const { data: favorites } = useFavorites();
  const toggleFavorite = useToggleFavorite();

  const compareItems = useCompareStore((state) => state.items);
  const toggleCompare = useCompareStore((state) => state.toggle);

  const favoriteSet = useMemo(() => new Set((favorites ?? []).map((item) => item.product_id)), [favorites]);
  const compareSet = useMemo(() => new Set(compareItems.map((item) => item.id)), [compareItems]);

  const referenceCategory = useMemo(() => {
    for (const entry of compareItems) {
      const normalized = String(entry.category ?? "").trim().toLowerCase();
      if (normalized) return normalized;
    }
    return undefined;
  }, [compareItems]);

  const offerQueries = useQueries({
    queries:
      viewMode === "list"
        ? items.map((item) => ({
            queryKey: ["catalog", "offers", item.id, "list-view"],
            queryFn: () => catalogApi.getOffers(item.id, { sort: "price", limit: 4 }),
            staleTime: 60_000,
          }))
        : [],
  });

  const offersByProductId = useMemo(() => {
    const map = new Map<string, ProductOffer[]>();
    if (viewMode !== "list") return map;
    items.forEach((item, index) => {
      map.set(item.id, offerQueries[index]?.data ?? []);
    });
    return map;
  }, [items, offerQueries, viewMode]);

  if (loading) {
    return <ProductGridSkeleton count={12} mode={viewMode} />;
  }

  if (viewMode === "list") {
    return (
      <div className="space-y-3">
        {items.map((item) => {
          const inCompare = compareSet.has(item.id);
          const normalizedCategory = String(item.category?.name ?? "").trim().toLowerCase();
          const categoryMismatch = Boolean(referenceCategory && normalizedCategory && referenceCategory !== normalizedCategory);
          const compareDisabled = !inCompare && (compareItems.length >= COMPARE_LIMIT || categoryMismatch);

          return (
            <ProductListRow
              key={item.id}
              product={item}
              favorite={favoriteSet.has(item.id)}
              onFavorite={(id) =>
                toggleFavorite.mutate({
                  productId: id,
                  currentPrice: item.min_price ?? null,
                })
              }
              compared={inCompare}
              compareDisabled={compareDisabled}
              compareDisabledReason={compareDisabled ? "Фақат битта категория ва максимум 4 товар" : undefined}
              onCompare={(id) =>
                toggleCompare({
                  id,
                  title: item.normalized_title,
                  slug: `${item.id}-${slugify(item.normalized_title)}`,
                  category: item.category?.name,
                  image: item.image_url,
                })
              }
              offers={offersByProductId.get(item.id)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <motion.div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {items.map((item) => {
        const inCompare = compareSet.has(item.id);
        const normalizedCategory = String(item.category?.name ?? "").trim().toLowerCase();
        const categoryMismatch = Boolean(referenceCategory && normalizedCategory && referenceCategory !== normalizedCategory);
        const compareDisabled = !inCompare && (compareItems.length >= COMPARE_LIMIT || categoryMismatch);

        return (
          <ProductCard
            key={item.id}
            product={item}
            favorite={favoriteSet.has(item.id)}
            onFavorite={(id) =>
              toggleFavorite.mutate({
                productId: id,
                currentPrice: item.min_price ?? null,
              })
            }
            compared={inCompare}
            compareDisabled={compareDisabled}
            compareDisabledReason={compareDisabled ? "Фақат битта категория ва максимум 4 товар" : undefined}
            onCompare={(id) =>
              toggleCompare({
                id,
                title: item.normalized_title,
                slug: `${item.id}-${slugify(item.normalized_title)}`,
                category: item.category?.name,
                image: item.image_url,
              })
            }
          />
        );
      })}
    </motion.div>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
