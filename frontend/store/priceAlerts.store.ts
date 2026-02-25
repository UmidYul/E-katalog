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
    (set, get) => {
      const updateMetas = (updater: (metas: Record<string, PriceAlertMeta>) => Record<string, PriceAlertMeta>) => {
        const currentMetas = get().metas;
        const nextMetas = updater(currentMetas);
        if (nextMetas === currentMetas) return;
        set({ metas: nextMetas });
      };

      return {
        metas: {},
        ensureMeta: (productId, currentPrice) => {
          if (!productId) return;
          updateMetas((metas) => ensurePriceAlertMeta(metas, productId, currentPrice));
        },
        setAlertsEnabled: (productId, enabled, currentPrice) => {
          if (!productId) return;
          updateMetas((metas) => setPriceAlertsEnabled(metas, productId, enabled, currentPrice));
        },
        setTargetPrice: (productId, targetPrice) => {
          if (!productId) return;
          if (!get().metas[productId]) return;
          updateMetas((metas) => setPriceAlertTarget(metas, productId, targetPrice));
        },
        resetBaseline: (productId, baselinePrice) => {
          if (!productId) return;
          if (!get().metas[productId]) return;
          updateMetas((metas) => resetPriceAlertBaseline(metas, productId, baselinePrice));
        },
        updateLastSeen: (productId, currentPrice) => {
          if (!productId) return;
          if (!get().metas[productId]) return;
          updateMetas((metas) => updatePriceAlertLastSeen(metas, productId, currentPrice));
        },
        markNotified: (productId) => {
          if (!productId) return;
          if (!get().metas[productId]) return;
          updateMetas((metas) => markPriceAlertNotified(metas, productId));
        },
        removeMeta: (productId) => {
          if (!productId) return;
          updateMetas((metas) => removePriceAlertMeta(metas, productId));
        },
        syncWithFavorites: (favoriteProductIds) => {
          updateMetas((metas) => syncPriceAlertMetasWithFavorites(metas, favoriteProductIds));
        }
      };
    },
    {
      name: "price-alerts-store-v1",
      skipHydration: true
    }
  )
);
