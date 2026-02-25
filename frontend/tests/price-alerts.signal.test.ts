import assert from "node:assert/strict";
import test from "node:test";

import { buildPriceAlertSignal, PRICE_DROP_AMOUNT_THRESHOLD, PRICE_DROP_PERCENT_THRESHOLD } from "../lib/utils/price-alerts.ts";
import type { PriceAlertMeta } from "../types/domain";

const createMeta = (overrides: Partial<PriceAlertMeta> = {}): PriceAlertMeta => ({
  product_id: "p-1",
  alerts_enabled: true,
  baseline_price: 1_000_000,
  target_price: null,
  last_seen_price: 1_000_000,
  last_notified_at: null,
  updated_at: "2026-02-25T00:00:00.000Z",
  ...overrides
});

test("buildPriceAlertSignal: срабатывает по проценту снижения", () => {
  const signal = buildPriceAlertSignal(createMeta({ baseline_price: 1_000_000 }), 960_000);
  assert.equal(signal.drop_pct >= PRICE_DROP_PERCENT_THRESHOLD, true);
  assert.equal(signal.is_drop, true);
  assert.equal(signal.drop_amount, 40_000);
});

test("buildPriceAlertSignal: срабатывает по абсолютной сумме снижения", () => {
  const baseline = 10_000_000;
  const current = baseline - PRICE_DROP_AMOUNT_THRESHOLD;
  const signal = buildPriceAlertSignal(createMeta({ baseline_price: baseline }), current);
  assert.equal(signal.drop_amount, PRICE_DROP_AMOUNT_THRESHOLD);
  assert.equal(signal.is_drop, true);
});

test("buildPriceAlertSignal: target hit работает независимо от drop", () => {
  const signal = buildPriceAlertSignal(createMeta({ baseline_price: 5_000_000, target_price: 4_900_000 }), 4_900_000);
  assert.equal(signal.is_target_hit, true);
  assert.equal(signal.current_price, 4_900_000);
});

test("buildPriceAlertSignal: при отсутствии baseline/current нет ложного drop", () => {
  const signalNoBaseline = buildPriceAlertSignal(createMeta({ baseline_price: null, target_price: 2_000_000 }), 1_900_000);
  assert.equal(signalNoBaseline.is_drop, false);
  assert.equal(signalNoBaseline.is_target_hit, true);

  const signalNoCurrent = buildPriceAlertSignal(createMeta({ baseline_price: 2_500_000, target_price: 2_000_000 }), null);
  assert.equal(signalNoCurrent.is_drop, false);
  assert.equal(signalNoCurrent.is_target_hit, false);
});
