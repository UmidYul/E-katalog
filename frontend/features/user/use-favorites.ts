"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authStore } from "@/store/auth.store";
import {
  addAnonymousFavorite,
  clearAnonymousFavorites,
  isAnonymousFavorite,
  readFavoriteIds,
  readFavoriteMetaMap,
  removeAnonymousFavorite,
  type FavoriteMetaMap,
  writeFavoriteIds,
  writeFavoriteMetaMap,
} from "@/lib/utils/favorites";

export type FavoriteListItem = {
  product_id: string;
  saved_price: number | null;
  added_at: string | null;
  current_min_price?: number | null;
  price_delta?: number | null;
  price_drop_percent?: number | null;
  category?: string | null;
  alerts_enabled?: boolean;
};

export const favoritesQueryKey = ["user", "favorites"] as const;

type ToggleFavoriteInput =
  | string
  | {
      productId: string;
      currentPrice?: number | null;
    };

const mergedAnonymousFavoritesByUser = new Set<string>();

const normalizeProductId = (value: unknown) => String(value ?? "").trim().toLowerCase();

const normalizePrice = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
};

const normalizeDate = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizeFavoriteItem = (item: unknown): FavoriteListItem | null => {
  if (!item || typeof item !== "object") return null;
  const candidate = item as Record<string, unknown>;
  const productId = normalizeProductId(candidate.product_id);
  if (!productId) return null;
  return {
    product_id: productId,
    saved_price: normalizePrice(candidate.saved_price),
    added_at: normalizeDate(candidate.added_at),
    current_min_price: normalizePrice(candidate.current_min_price),
    price_delta: Number.isFinite(Number(candidate.price_delta)) ? Number(candidate.price_delta) : null,
    price_drop_percent: Number.isFinite(Number(candidate.price_drop_percent)) ? Number(candidate.price_drop_percent) : null,
    category: typeof candidate.category === "string" ? candidate.category : null,
    alerts_enabled: Boolean(candidate.alerts_enabled),
  };
};

const readAnonymousFavorites = (): FavoriteListItem[] => {
  const ids = readFavoriteIds();
  const meta = readFavoriteMetaMap();
  return ids.map((productId) => ({
    product_id: productId,
    saved_price: meta[productId]?.savedPrice ?? null,
    added_at: meta[productId]?.addedAt ?? null,
    current_min_price: null,
    price_delta: null,
    price_drop_percent: null,
    category: null,
    alerts_enabled: false,
  }));
};

const syncAnonymousFromFavorites = (items: FavoriteListItem[]) => {
  const ids = items.map((item) => normalizeProductId(item.product_id)).filter(Boolean);
  const meta: FavoriteMetaMap = {};
  for (const item of items) {
    const id = normalizeProductId(item.product_id);
    if (!id) continue;
    meta[id] = {
      savedPrice: normalizePrice(item.saved_price),
      addedAt: item.added_at ?? new Date().toISOString(),
    };
  }
  writeFavoriteIds(ids);
  writeFavoriteMetaMap(meta);
};

const normalizeToggleInput = (input: ToggleFavoriteInput) => {
  if (typeof input === "string") {
    return { productId: normalizeProductId(input), currentPrice: null as number | null };
  }
  return {
    productId: normalizeProductId(input.productId),
    currentPrice: normalizePrice(input.currentPrice),
  };
};

export const useFavorites = () => {
  const isAuthenticated = authStore((s) => s.isAuthenticated);
  const userId = authStore((s) => s.user?.id ?? null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    if (mergedAnonymousFavoritesByUser.has(userId)) return;

    mergedAnonymousFavoritesByUser.add(userId);

    let cancelled = false;
    const run = async () => {
      const ids = readFavoriteIds();
      if (!ids.length) {
        await queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
        return;
      }

      const meta = readFavoriteMetaMap();
      let mergedCount = 0;
      for (const id of ids) {
        const payload = {
          productId: id,
          currentPrice: meta[id]?.savedPrice ?? null,
        };

        try {
          const response = await fetch("/api/favorites/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            cache: "no-store",
          });
          if (response.ok) mergedCount += 1;
        } catch {
          // ignore merge item failures
        }
      }

      if (mergedCount === ids.length) {
        clearAnonymousFavorites();
      }
      if (!cancelled) {
        await queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, queryClient, userId]);

  return useQuery({
    queryKey: favoritesQueryKey,
    queryFn: async () => {
      if (!isAuthenticated) {
        return readAnonymousFavorites();
      }

      const response = await fetch("/api/favorites", {
        cache: "no-store",
      });

      if (response.status === 401) return [];
      if (!response.ok) throw new Error("favorites_fetch_failed");

      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) return [];
      return payload
        .map((item) => normalizeFavoriteItem(item))
        .filter((item): item is FavoriteListItem => Boolean(item));
    },
    retry: false,
  });
};

export const useToggleFavorite = () => {
  const queryClient = useQueryClient();
  const isAuthenticated = authStore((s) => s.isAuthenticated);

  return useMutation({
    mutationFn: async (input: ToggleFavoriteInput) => {
      const { productId, currentPrice } = normalizeToggleInput(input);
      if (!productId) throw new Error("favorite_product_id_required");

      if (!isAuthenticated) {
        const alreadyFavorite = isAnonymousFavorite(productId);
        if (alreadyFavorite) {
          removeAnonymousFavorite(productId);
          return { ok: true, product_id: productId, favorited: false };
        }
        addAnonymousFavorite(productId, currentPrice);
        return { ok: true, product_id: productId, favorited: true };
      }

      const response = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          currentPrice,
        }),
        cache: "no-store",
      });

      if (!response.ok) throw new Error("favorite_toggle_failed");
      return (await response.json()) as { ok: boolean; product_id: string; favorited: boolean };
    },
    onMutate: async (input) => {
      const { productId, currentPrice } = normalizeToggleInput(input);
      if (!productId) return { previous: [] as FavoriteListItem[] };

      await queryClient.cancelQueries({ queryKey: favoritesQueryKey });
      const previous = queryClient.getQueryData<FavoriteListItem[]>(favoritesQueryKey) ?? [];
      const alreadyFavorite = previous.some((item) => item.product_id === productId);

      const next = alreadyFavorite
        ? previous.filter((item) => item.product_id !== productId)
        : [
            {
              product_id: productId,
              saved_price: currentPrice,
              added_at: new Date().toISOString(),
              current_min_price: currentPrice,
              price_delta: 0,
              price_drop_percent: 0,
              category: null,
              alerts_enabled: false,
            },
            ...previous,
          ];

      queryClient.setQueryData(favoritesQueryKey, next);

      if (!isAuthenticated) {
        syncAnonymousFromFavorites(next);
      }

      return { previous };
    },
    onError: (_error, _input, context) => {
      if (!context?.previous) return;
      queryClient.setQueryData(favoritesQueryKey, context.previous);
      if (!isAuthenticated) {
        syncAnonymousFromFavorites(context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
    },
  });
};

export const useRemoveFavorite = () => {
  const queryClient = useQueryClient();
  const isAuthenticated = authStore((s) => s.isAuthenticated);

  return useMutation({
    mutationFn: async (productIdRaw: string) => {
      const productId = normalizeProductId(productIdRaw);
      if (!productId) throw new Error("favorite_product_id_required");

      if (!isAuthenticated) {
        removeAnonymousFavorite(productId);
        return { ok: true, product_id: productId, favorited: false };
      }

      const response = await fetch(`/api/favorites/${productId}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("favorite_remove_failed");
      return (await response.json()) as { ok: boolean; product_id: string; favorited: false };
    },
    onMutate: async (productIdRaw) => {
      const productId = normalizeProductId(productIdRaw);
      await queryClient.cancelQueries({ queryKey: favoritesQueryKey });
      const previous = queryClient.getQueryData<FavoriteListItem[]>(favoritesQueryKey) ?? [];
      const next = previous.filter((item) => item.product_id !== productId);
      queryClient.setQueryData(favoritesQueryKey, next);
      if (!isAuthenticated) {
        syncAnonymousFromFavorites(next);
      }
      return { previous };
    },
    onError: (_error, _productId, context) => {
      if (!context?.previous) return;
      queryClient.setQueryData(favoritesQueryKey, context.previous);
      if (!isAuthenticated) {
        syncAnonymousFromFavorites(context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
    },
  });
};
