import type { PriceAlertMeta, PriceAlertSignal } from "@/types/domain";

export const PRICE_DROP_PERCENT_THRESHOLD = 3;
export const PRICE_DROP_AMOUNT_THRESHOLD = 50_000;

const normalizePrice = (value: unknown): number | null => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
};

export const buildPriceAlertSignal = (meta: PriceAlertMeta, currentPriceRaw: unknown): PriceAlertSignal => {
  const currentPrice = normalizePrice(currentPriceRaw);
  const baselinePrice = normalizePrice(meta.baseline_price);
  const targetPrice = normalizePrice(meta.target_price);

  if (currentPrice == null || baselinePrice == null) {
    return {
      product_id: meta.product_id,
      current_price: currentPrice,
      baseline_price: baselinePrice,
      target_price: targetPrice,
      drop_amount: 0,
      drop_pct: 0,
      is_drop: false,
      is_target_hit: Boolean(targetPrice != null && currentPrice != null && currentPrice <= targetPrice)
    };
  }

  const dropAmount = Math.max(0, baselinePrice - currentPrice);
  const dropPct = baselinePrice > 0 ? (dropAmount / baselinePrice) * 100 : 0;
  const isDrop = dropPct >= PRICE_DROP_PERCENT_THRESHOLD || dropAmount >= PRICE_DROP_AMOUNT_THRESHOLD;
  const isTargetHit = Boolean(targetPrice != null && currentPrice <= targetPrice);

  return {
    product_id: meta.product_id,
    current_price: currentPrice,
    baseline_price: baselinePrice,
    target_price: targetPrice,
    drop_amount: dropAmount,
    drop_pct: dropPct,
    is_drop: isDrop,
    is_target_hit: isTargetHit
  };
};

export const toPositivePriceOrNull = (value: unknown): number | null => normalizePrice(value);
