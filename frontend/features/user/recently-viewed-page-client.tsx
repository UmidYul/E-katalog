"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ProductCard } from "@/components/catalog/product-card";
import { ProductGridSkeleton } from "@/components/catalog/catalog-grid";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { useAuthMe } from "@/features/auth/use-auth";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { catalogApi } from "@/lib/api/openapi-client";
import { cn } from "@/lib/utils/cn";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";
import type { ProductDetail, ProductListItem } from "@/types/domain";

type RemoteRecentItem = {
  id: string;
  slug?: string;
  title?: string;
  image_url?: string | null;
  min_price?: number | null;
  viewed_at: string;
};

type RecentItem = {
  id: string;
  viewedAt: string | null;
  order: number;
};

const RECENT_STORAGE_KEY = "doxx_recent";

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-");

const parseStoredIds = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const payload = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(payload)) return [];
    return payload.map((entry) => String(entry ?? "").trim()).filter(Boolean).slice(0, 20);
  } catch {
    return [];
  }
};

const normalizeDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const minPriceFromDetail = (detail: ProductDetail): number | null => {
  const values = (detail.offers_by_store ?? [])
    .map((store) => Number(store.minimal_price ?? 0))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (!values.length) return null;
  return Math.round(Math.min(...values));
};

const maxPriceDropPct = (detail: ProductDetail): number | undefined => {
  const drops = (detail.offers_by_store ?? [])
    .flatMap((store) => store.offers ?? [])
    .map((offer) => {
      const oldPrice = Number(offer.old_price_amount ?? 0);
      const currentPrice = Number(offer.price_amount ?? 0);
      if (!oldPrice || !currentPrice || oldPrice <= currentPrice) return 0;
      return Math.round(((oldPrice - currentPrice) / oldPrice) * 100);
    })
    .filter((value) => value > 0);
  if (!drops.length) return undefined;
  return Math.max(...drops);
};

const toProductCardItem = (productId: string, detail: ProductDetail): ProductListItem => {
  const minPrice = minPriceFromDetail(detail);
  return {
    id: productId,
    normalized_title: detail.title || productId,
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
    price_drop_pct: maxPriceDropPct(detail),
  };
};

const formatViewedTime = (value: string | null) => {
  if (!value) return "Яқинда";
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return "Яқинда";
  const diff = Date.now() - parsed;
  if (diff < 3_600_000) {
    const minutes = Math.max(1, Math.floor(diff / 60_000));
    return `${minutes} дақиқа олдин`;
  }
  if (diff < 86_400_000) {
    const hours = Math.max(1, Math.floor(diff / 3_600_000));
    return `${hours} соат олдин`;
  }
  if (diff < 172_800_000) return "Кеча";
  if (diff < 7 * 86_400_000) {
    const days = Math.floor(diff / 86_400_000);
    return `${days} кун олдин`;
  }
  return new Date(value).toLocaleDateString("ru-RU");
};

export function RecentlyViewedPageClient() {
  const me = useAuthMe();
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();

  const compareItems = useCompareStore((state) => state.items);
  const toggleCompare = useCompareStore((state) => state.toggle);

  const storeItems = useRecentlyViewedStore((state) => state.items);
  const clearStoreItems = useRecentlyViewedStore((state) => state.clear);

  const [localIds, setLocalIds] = useState<string[]>([]);

  useEffect(() => {
    setLocalIds(parseStoredIds());
  }, []);

  const serverRecent = useQuery({
    queryKey: ["recently-viewed", "server"],
    enabled: Boolean(me.data?.id),
    queryFn: async (): Promise<RemoteRecentItem[]> => {
      const response = await fetch("/api/user/recently-viewed", { cache: "no-store" });
      if (!response.ok) return [];
      const payload = (await response.json()) as unknown;
      return Array.isArray(payload) ? (payload as RemoteRecentItem[]) : [];
    },
  });

  const mergedRecent = useMemo<RecentItem[]>(() => {
    const map = new Map<string, RecentItem>();
    const storeTimeMap = new Map(storeItems.map((item) => [String(item.id), normalizeDate(item.viewedAt)]));

    localIds.forEach((id, index) => {
      map.set(id, {
        id,
        viewedAt: storeTimeMap.get(id) ?? null,
        order: index,
      });
    });

    (serverRecent.data ?? []).forEach((entry, index) => {
      const id = String(entry.id ?? "").trim();
      if (!id) return;
      const remoteTime = normalizeDate(entry.viewed_at);
      const existing = map.get(id);
      const existingTime = existing?.viewedAt ? new Date(existing.viewedAt).getTime() : 0;
      const remoteStamp = remoteTime ? new Date(remoteTime).getTime() : 0;
      if (!existing) {
        map.set(id, {
          id,
          viewedAt: remoteTime,
          order: localIds.length + index,
        });
        return;
      }
      if (remoteStamp > existingTime) {
        map.set(id, {
          ...existing,
          viewedAt: remoteTime,
        });
      }
    });

    return Array.from(map.values())
      .sort((left, right) => {
        const leftTime = left.viewedAt ? new Date(left.viewedAt).getTime() : 0;
        const rightTime = right.viewedAt ? new Date(right.viewedAt).getTime() : 0;
        if (rightTime !== leftTime) return rightTime - leftTime;
        return left.order - right.order;
      })
      .slice(0, 20);
  }, [localIds, serverRecent.data, storeItems]);

  const productIds = useMemo(() => mergedRecent.map((item) => item.id), [mergedRecent]);
  const viewedAtById = useMemo(() => new Map(mergedRecent.map((item) => [item.id, item.viewedAt])), [mergedRecent]);

  const productQueries = useQueries({
    queries: productIds.map((productId) => ({
      queryKey: ["recently-viewed", "product", productId],
      queryFn: () => catalogApi.getProduct(productId),
      staleTime: 60_000,
      retry: false,
    })),
  });

  const cards = useMemo(() => {
    return productIds.flatMap((productId, index) => {
      const detail = productQueries[index]?.data as ProductDetail | undefined;
      if (!detail) return [];
      return [
        {
          id: productId,
          product: toProductCardItem(productId, detail),
          viewedAt: viewedAtById.get(productId) ?? null,
        },
      ];
    });
  }, [productIds, productQueries, viewedAtById]);

  const favoriteSet = useMemo(
    () => new Set((favorites.data ?? []).map((item) => item.product_id)),
    [favorites.data],
  );
  const compareSet = useMemo(() => new Set(compareItems.map((item) => item.id)), [compareItems]);

  const referenceCompareCategory = useMemo(() => {
    for (const compareItem of compareItems) {
      const category = String(compareItem.category ?? "").trim().toLowerCase();
      if (category) return category;
    }
    return undefined;
  }, [compareItems]);

  const loadingProducts = productQueries.some((query) => query.isLoading || query.isFetching);

  const clearHistory = async () => {
    clearStoreItems();
    setLocalIds([]);
    try {
      window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify([]));
    } catch {
      // ignore localStorage errors
    }
    try {
      await fetch("/api/user/recently-viewed", { method: "DELETE" });
    } catch {
      // ignore network errors
    }
  };

  if (!mergedRecent.length) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <EmptyState
          title="Сиз ҳали бирорта товарни кўрмагансиз"
          description="Каталогдан товар очсангиз, тарих шу ерда кўринади."
          action={
            <Link href="/catalog" className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Каталогга ўтиш
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-2xl font-bold">Кўрилган товарлар</h1>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
          {mergedRecent.length} та
        </span>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={clearHistory}>
          Тарихни тозалаш
        </Button>
      </header>

      {loadingProducts && !cards.length ? (
        <ProductGridSkeleton count={Math.min(12, Math.max(6, productIds.length))} mode="grid" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const inCompare = compareSet.has(card.id);
            const normalizedCategory = String(card.product.category?.name ?? "").trim().toLowerCase();
            const categoryMismatch =
              Boolean(referenceCompareCategory && normalizedCategory && referenceCompareCategory !== normalizedCategory);
            const compareDisabled = !inCompare && (compareItems.length >= COMPARE_LIMIT || categoryMismatch);

            return (
              <div key={card.id} className="space-y-2">
                <ProductCard
                  product={card.product}
                  favorite={favoriteSet.has(card.id)}
                  onFavorite={() =>
                    toggleFavorite.mutate({
                      productId: card.id,
                      currentPrice: card.product.min_price ?? null,
                    })
                  }
                  compared={inCompare}
                  compareDisabled={compareDisabled}
                  compareDisabledReason={compareDisabled ? "Фақат битта категория ва максимум 4 товар" : undefined}
                  onCompare={() =>
                    toggleCompare({
                      id: card.id,
                      title: card.product.normalized_title,
                      slug: `${card.id}-${slugify(card.product.normalized_title)}`,
                      category: card.product.category?.name,
                      image: card.product.image_url,
                    })
                  }
                />
                <div className={cn("rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground")}>
                  Кўрилган вақт: {formatViewedTime(card.viewedAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
