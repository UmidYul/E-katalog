import assert from "node:assert/strict";
import test from "node:test";

import {
  ensurePriceAlertMeta,
  resetPriceAlertBaseline,
  setPriceAlertsEnabled,
  syncPriceAlertMetasWithFavorites
} from "../store/priceAlerts.logic.ts";
import type { PriceAlertMetaMap } from "../store/priceAlerts.logic.ts";

test("store logic: baseline фиксируется при первом добавлении в избранное", () => {
  const metas = ensurePriceAlertMeta({}, "p-1", 12_000_000, "2026-02-25T00:00:00.000Z");
  assert.equal(metas["p-1"]?.baseline_price, 12_000_000);
  assert.equal(metas["p-1"]?.alerts_enabled, true);
  assert.equal(metas["p-1"]?.last_seen_price, 12_000_000);
});

test("store logic: baseline можно обновить вручную", () => {
  const initial = ensurePriceAlertMeta({}, "p-1", 12_000_000, "2026-02-25T00:00:00.000Z");
  const reset = resetPriceAlertBaseline(initial, "p-1", 11_500_000, "2026-02-25T01:00:00.000Z");
  assert.equal(reset["p-1"]?.baseline_price, 11_500_000);
  assert.equal(reset["p-1"]?.last_seen_price, 11_500_000);
  assert.equal(reset["p-1"]?.updated_at, "2026-02-25T01:00:00.000Z");
});

test("store logic: syncWithFavorites удаляет лишние метаданные", () => {
  const seed: PriceAlertMetaMap = {
    "p-1": ensurePriceAlertMeta({}, "p-1", 1_000_000, "2026-02-25T00:00:00.000Z")["p-1"]!,
    "p-2": ensurePriceAlertMeta({}, "p-2", 2_000_000, "2026-02-25T00:00:00.000Z")["p-2"]!,
    "p-3": ensurePriceAlertMeta({}, "p-3", 3_000_000, "2026-02-25T00:00:00.000Z")["p-3"]!
  };
  const synced = syncPriceAlertMetasWithFavorites(seed, ["p-2"]);
  assert.deepEqual(Object.keys(synced), ["p-2"]);
});

test("store logic: включение алерта создаёт мету и сохраняет baseline", () => {
  const enabled = setPriceAlertsEnabled({}, "p-9", true, 9_000_000, "2026-02-25T00:00:00.000Z");
  assert.equal(enabled["p-9"]?.alerts_enabled, true);
  assert.equal(enabled["p-9"]?.baseline_price, 9_000_000);
});
