import assert from "node:assert/strict";
import test from "node:test";

import { filterAlertEvents, toDonutRows } from "../lib/utils/admin-analytics.ts";
import type { AdminAlertEvent } from "../types/admin";

const seedAlerts: AdminAlertEvent[] = [
  {
    id: "a1",
    code: "orders.cancel_rate",
    title: "Cancel rate",
    source: "revenue",
    severity: "warning",
    status: "open",
    metric_value: 0.1,
    threshold_value: 0.08,
    context: {},
    created_at: "2026-02-25T00:00:00.000Z",
  },
  {
    id: "a2",
    code: "moderation.pending_total",
    title: "Pending moderation",
    source: "moderation",
    severity: "critical",
    status: "ack",
    metric_value: 720,
    threshold_value: 500,
    context: {},
    created_at: "2026-02-25T00:10:00.000Z",
  },
];

test("filterAlertEvents filters by status/severity/source", () => {
  const openOnly = filterAlertEvents(seedAlerts, { status: "open", severity: "all", source: "all" });
  assert.equal(openOnly.length, 1);
  assert.equal(openOnly[0]?.id, "a1");

  const criticalModeration = filterAlertEvents(seedAlerts, { status: "all", severity: "critical", source: "moderation" });
  assert.equal(criticalModeration.length, 1);
  assert.equal(criticalModeration[0]?.id, "a2");
});

test("toDonutRows maps rows with palette colors", () => {
  const mapped = toDonutRows(
    [
      { name: "open", value: 10 },
      { name: "ack", value: 4 },
      { name: "resolved", value: 3 },
    ],
    ["#111111", "#222222"],
  );
  assert.equal(mapped.length, 3);
  assert.equal(mapped[0]?.color, "#111111");
  assert.equal(mapped[1]?.color, "#222222");
  assert.equal(mapped[2]?.color, "#111111");
});
