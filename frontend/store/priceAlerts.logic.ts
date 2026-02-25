import { toPositivePriceOrNull } from "../lib/utils/price-alerts.ts";
import type { PriceAlertMeta } from "../types/domain";

export type PriceAlertMetaMap = Record<string, PriceAlertMeta>;

export const nowIso = () => new Date().toISOString();

export const createPriceAlertMeta = (productId: string, currentPrice?: number | null, timestamp: string = nowIso()): PriceAlertMeta => {
  const normalized = toPositivePriceOrNull(currentPrice);
  return {
    product_id: productId,
    alerts_enabled: true,
    baseline_price: normalized,
    target_price: null,
    last_seen_price: normalized,
    last_notified_at: null,
    updated_at: timestamp
  };
};

export const ensurePriceAlertMeta = (
  metas: PriceAlertMetaMap,
  productId: string,
  currentPrice?: number | null,
  timestamp: string = nowIso()
): PriceAlertMetaMap => {
  if (!productId) return metas;
  const normalizedPrice = toPositivePriceOrNull(currentPrice);
  const existing = metas[productId];
  if (!existing) {
    return {
      ...metas,
      [productId]: createPriceAlertMeta(productId, normalizedPrice, timestamp)
    };
  }
  if (normalizedPrice == null) return metas;
  const nextBaselinePrice = existing.baseline_price ?? normalizedPrice;
  if (nextBaselinePrice === existing.baseline_price && existing.last_seen_price === normalizedPrice) {
    return metas;
  }
  return {
    ...metas,
    [productId]: {
      ...existing,
      baseline_price: nextBaselinePrice,
      last_seen_price: normalizedPrice,
      updated_at: timestamp
    }
  };
};

export const setPriceAlertsEnabled = (
  metas: PriceAlertMetaMap,
  productId: string,
  enabled: boolean,
  currentPrice?: number | null,
  timestamp: string = nowIso()
): PriceAlertMetaMap => {
  if (!productId) return metas;
  const existing = metas[productId];
  const normalizedPrice = toPositivePriceOrNull(currentPrice);
  const meta = existing ?? createPriceAlertMeta(productId, normalizedPrice, timestamp);
  const nextBaselinePrice = meta.baseline_price ?? normalizedPrice;
  const nextLastSeenPrice = normalizedPrice ?? meta.last_seen_price;
  if (
    existing &&
    existing.alerts_enabled === enabled &&
    existing.baseline_price === nextBaselinePrice &&
    existing.last_seen_price === nextLastSeenPrice
  ) {
    return metas;
  }
  return {
    ...metas,
    [productId]: {
      ...meta,
      alerts_enabled: enabled,
      baseline_price: nextBaselinePrice,
      last_seen_price: nextLastSeenPrice,
      updated_at: timestamp
    }
  };
};

export const setPriceAlertTarget = (
  metas: PriceAlertMetaMap,
  productId: string,
  targetPrice: number | null,
  timestamp: string = nowIso()
): PriceAlertMetaMap => {
  if (!productId) return metas;
  const existing = metas[productId];
  if (!existing) return metas;
  const normalizedTargetPrice = toPositivePriceOrNull(targetPrice);
  if (existing.target_price === normalizedTargetPrice) return metas;
  return {
    ...metas,
    [productId]: {
      ...existing,
      target_price: normalizedTargetPrice,
      updated_at: timestamp
    }
  };
};

export const resetPriceAlertBaseline = (
  metas: PriceAlertMetaMap,
  productId: string,
  baselinePrice: number | null,
  timestamp: string = nowIso()
): PriceAlertMetaMap => {
  if (!productId) return metas;
  const existing = metas[productId];
  if (!existing) return metas;
  const normalized = toPositivePriceOrNull(baselinePrice);
  if (existing.baseline_price === normalized && existing.last_seen_price === normalized) {
    return metas;
  }
  return {
    ...metas,
    [productId]: {
      ...existing,
      baseline_price: normalized,
      last_seen_price: normalized,
      updated_at: timestamp
    }
  };
};

export const updatePriceAlertLastSeen = (
  metas: PriceAlertMetaMap,
  productId: string,
  currentPrice: number | null,
  timestamp: string = nowIso()
): PriceAlertMetaMap => {
  if (!productId) return metas;
  const existing = metas[productId];
  const normalized = toPositivePriceOrNull(currentPrice);
  if (!existing || normalized == null) return metas;
  const nextBaselinePrice = existing.baseline_price ?? normalized;
  if (existing.last_seen_price === normalized && existing.baseline_price === nextBaselinePrice) {
    return metas;
  }
  return {
    ...metas,
    [productId]: {
      ...existing,
      last_seen_price: normalized,
      baseline_price: nextBaselinePrice,
      updated_at: timestamp
    }
  };
};

export const markPriceAlertNotified = (metas: PriceAlertMetaMap, productId: string, timestamp: string = nowIso()): PriceAlertMetaMap => {
  if (!productId) return metas;
  const existing = metas[productId];
  if (!existing) return metas;
  return {
    ...metas,
    [productId]: {
      ...existing,
      last_notified_at: timestamp,
      updated_at: timestamp
    }
  };
};

export const removePriceAlertMeta = (metas: PriceAlertMetaMap, productId: string): PriceAlertMetaMap => {
  if (!productId || !metas[productId]) return metas;
  const next = { ...metas };
  delete next[productId];
  return next;
};

export const syncPriceAlertMetasWithFavorites = (metas: PriceAlertMetaMap, favoriteProductIds: string[]): PriceAlertMetaMap => {
  const favoriteSet = new Set(favoriteProductIds.filter(Boolean));
  const nextEntries = Object.entries(metas).filter(([productId]) => favoriteSet.has(productId));
  if (nextEntries.length === Object.keys(metas).length) return metas;
  return Object.fromEntries(nextEntries);
};
