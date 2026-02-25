import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { PriceAlertMeta } from "@/types/domain";
import {
  ensurePriceAlertMeta,
  markPriceAlertNotified,
  removePriceAlertMeta,
  resetPriceAlertBaseline,
  setPriceAlertTarget,
  setPriceAlertsEnabled,
  syncPriceAlertMetasWithFavorites,
  updatePriceAlertLastSeen
} from "@/store/priceAlerts.logic";

type PriceAlertsState = {
  metas: Record<string, PriceAlertMeta>;
  ensureMeta: (productId: string, currentPrice?: number | null) => void;
  setAlertsEnabled: (productId: string, enabled: boolean, currentPrice?: number | null) => void;
  setTargetPrice: (productId: string, targetPrice: number | null) => void;
  resetBaseline: (productId: string, baselinePrice: number | null) => void;
  updateLastSeen: (productId: string, currentPrice: number | null) => void;
  markNotified: (productId: string) => void;
  removeMeta: (productId: string) => void;
  syncWithFavorites: (favoriteProductIds: string[]) => void;
};

export const usePriceAlertsStore = create<PriceAlertsState>()(
  persist(
    (set, get) => ({
      metas: {},
      ensureMeta: (productId, currentPrice) => {
        if (!productId) return;
        set((state) => ({ metas: ensurePriceAlertMeta(state.metas, productId, currentPrice) }));
      },
      setAlertsEnabled: (productId, enabled, currentPrice) => {
        if (!productId) return;
        set((state) => ({ metas: setPriceAlertsEnabled(state.metas, productId, enabled, currentPrice) }));
      },
      setTargetPrice: (productId, targetPrice) => {
        if (!productId) return;
        if (!get().metas[productId]) return;
        set((state) => ({ metas: setPriceAlertTarget(state.metas, productId, targetPrice) }));
      },
      resetBaseline: (productId, baselinePrice) => {
        if (!productId) return;
        if (!get().metas[productId]) return;
        set((state) => ({ metas: resetPriceAlertBaseline(state.metas, productId, baselinePrice) }));
      },
      updateLastSeen: (productId, currentPrice) => {
        if (!productId) return;
        if (!get().metas[productId]) return;
        set((state) => ({ metas: updatePriceAlertLastSeen(state.metas, productId, currentPrice) }));
      },
      markNotified: (productId) => {
        if (!productId) return;
        if (!get().metas[productId]) return;
        set((state) => ({ metas: markPriceAlertNotified(state.metas, productId) }));
      },
      removeMeta: (productId) => {
        if (!productId) return;
        set((state) => ({ metas: removePriceAlertMeta(state.metas, productId) }));
      },
      syncWithFavorites: (favoriteProductIds) => {
        set((state) => ({ metas: syncPriceAlertMetasWithFavorites(state.metas, favoriteProductIds) }));
      }
    }),
    {
      name: "price-alerts-store-v1",
      skipHydration: true
    }
  )
);
