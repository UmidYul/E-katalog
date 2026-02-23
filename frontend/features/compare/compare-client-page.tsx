"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompareProducts } from "@/features/compare/use-compare";
import { formatColorValue } from "@/lib/utils/color-name";
import { cn } from "@/lib/utils/cn";
import { formatSpecLabel, normalizeSpecsMap } from "@/lib/utils/specs";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";

const normalizeValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "string") return value.trim() || "-";
  return JSON.stringify(value);
};

const hasDiffInRow = (values: unknown[]) => {
  const unique = new Set(values.map((value) => normalizeValue(value)));
  return unique.size > 1;
};

const parseNumeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(",", ".");
  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const lowerIsBetterHints = ["price", "cost", "weight", "thickness", "depth", "height", "width", "length", "latency", "delay", "charge"];

const isLowerBetter = (specKey: string) => {
  const key = specKey.toLowerCase();
  return lowerIsBetterHints.some((hint) => key.includes(hint));
};

const getBestCellIndexes = (specKey: string, values: unknown[]) => {
  if (specKey.includes("color")) return new Set<number>();

  const numericValues = values
    .map((value, index) => ({ index, value: parseNumeric(value) }))
    .filter((item): item is { index: number; value: number } => item.value !== null);

  if (numericValues.length < 2) return new Set<number>();

  const spread = Math.max(...numericValues.map((item) => item.value)) - Math.min(...numericValues.map((item) => item.value));
  if (spread === 0) return new Set<number>();

  const target = isLowerBetter(specKey)
    ? Math.min(...numericValues.map((item) => item.value))
    : Math.max(...numericValues.map((item) => item.value));

  return new Set(numericValues.filter((item) => Math.abs(item.value - target) < 1e-9).map((item) => item.index));
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
};

const formatCategory = (value?: string) => {
  if (!value) return undefined;
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const normalizeCategory = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
};

const rowPriorityOrder = ["price_min", "price_max", "store_count"];

const formatInteger = (value: number) => Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const renderCellValue = (rowKey: string, value: unknown) => {
  if (rowKey === "price_min" || rowKey === "price_max") {
    const numeric = parseNumeric(value);
    if (numeric !== null) return `${formatInteger(numeric)} UZS`;
  }
  if (rowKey.includes("color") && typeof value === "string") {
    return formatColorValue(value);
  }
  return normalizeValue(value);
};

export function CompareClientPage() {
  const compareItems = useCompareStore((s) => s.items);
  const history = useCompareStore((s) => s.history);
  const remove = useCompareStore((s) => s.remove);
  const clear = useCompareStore((s) => s.clear);
  const saveSnapshot = useCompareStore((s) => s.saveSnapshot);
  const restoreSnapshot = useCompareStore((s) => s.restoreSnapshot);
  const clearHistory = useCompareStore((s) => s.clearHistory);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const productIds = useMemo(() => compareItems.map((item) => item.id), [compareItems]);
  const compareQuery = useCompareProducts(productIds);
  const productMetaById = useMemo(() => new Map(compareItems.map((item) => [item.id, item])), [compareItems]);
  const categoryScope = useMemo(() => {
    for (const item of compareItems) {
      const category = normalizeCategory(item.category);
      if (category) return category;
    }
    return undefined;
  }, [compareItems]);

  useEffect(() => {
    if (!compareQuery.isSuccess || compareItems.length < 2) return;
    saveSnapshot(compareItems);
  }, [compareItems, compareQuery.isSuccess, saveSnapshot]);

  const rows = useMemo(() => {
    const items = compareQuery.data?.items ?? [];
    const normalizedItems = items.map((item) => normalizeSpecsMap({ ...(item.attributes ?? {}), ...(item.specs ?? {}) }));
    const keys = Array.from(new Set(normalizedItems.flatMap((specs) => Object.keys(specs)))).sort((a, b) => {
      const aPriority = rowPriorityOrder.indexOf(a);
      const bPriority = rowPriorityOrder.indexOf(b);
      if (aPriority !== -1 || bPriority !== -1) {
        if (aPriority === -1) return 1;
        if (bPriority === -1) return -1;
        return aPriority - bPriority;
      }
      return a.localeCompare(b);
    });

    const allRows = keys.map((key) => {
      const values = normalizedItems.map((specs) => specs[key]);
      return { key, label: formatSpecLabel(key), values, bestCellIndexes: getBestCellIndexes(key, values) };
    });

    if (!onlyDiff) return allRows;
    return allRows.filter((row) => hasDiffInRow(row.values));
  }, [compareQuery.data?.items, onlyDiff]);

  if (compareItems.length === 0) {
    return (
      <div className="container space-y-3 py-6">
        <EmptyState title="Comparison is empty" message="Add products from catalog or product page to start comparing." />
        <Link href="/catalog">
          <Button>Go to catalog</Button>
        </Link>
        {history.length ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent comparisons</CardTitle>
              <Button variant="ghost" size="sm" onClick={clearHistory}>
                Clear history
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.slice(0, 6).map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div>
                    <p className="line-clamp-1 text-sm font-medium">{entry.items.map((item) => item.title).join(" vs ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)} | {entry.items.length} products
                      {entry.category ? ` | ${formatCategory(entry.category)}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                    Restore
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  if (compareItems.length === 1) {
    const onlyItem = compareItems[0];
    if (!onlyItem) return null;

    return (
      <div className="container space-y-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Comparison needs at least 2 products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">You currently selected one product. Add one more to see a full comparison matrix.</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/product/${onlyItem.slug}`}>
                <Button variant="outline">Open selected product</Button>
              </Link>
              <Link href="/catalog">
                <Button>Add one more product</Button>
              </Link>
              <Button variant="ghost" onClick={clear}>
                Clear
              </Button>
            </div>
            {history.length ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">Recent comparisons:</p>
                <div className="flex flex-wrap gap-2">
                  {history.slice(0, 4).map((entry) => (
                    <Button key={entry.id} size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                      Restore {entry.items.length} items
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (compareQuery.error) {
    return (
      <div className="container py-6">
        <ErrorState title="Could not build comparison" message="Try removing unavailable products and retry." />
      </div>
    );
  }

  const columns = compareQuery.data?.items ?? [];

  return (
    <div className="container space-y-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Comparison</h1>
            <Badge>{compareItems.length}/{COMPARE_LIMIT} selected</Badge>
            {categoryScope ? <Badge className="bg-secondary/80">{formatCategory(categoryScope)}</Badge> : null}
            {compareQuery.isFetching ? <Badge className="bg-secondary/80">Updating...</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">Compare works within one category. Best-value highlighting is heuristic for numeric specs.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={onlyDiff ? "default" : "outline"} size="sm" onClick={() => setOnlyDiff((prev) => !prev)}>
            {onlyDiff ? "Showing differences" : "Show only differences"}
          </Button>
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear all
          </Button>
          {history.length ? (
            <Button variant="ghost" size="sm" onClick={clearHistory}>
              Clear history
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {compareItems.map((item) => (
          <Card key={item.id}>
            <CardContent className="space-y-2 p-4">
              <Link href={`/product/${item.slug}`} className="line-clamp-2 text-sm font-semibold text-primary hover:underline">
                {item.title}
              </Link>
              <div className="flex gap-2">
                <Link href={`/product/${item.slug}`}>
                  <Button size="sm" variant="outline">
                    Open
                  </Button>
                </Link>
                <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="overflow-x-auto p-0">
          {compareQuery.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading comparison matrix...</div>
          ) : (
            <table className="min-w-[760px] w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="sticky left-0 z-10 min-w-56 bg-card px-4 py-3 text-left text-sm font-semibold">Характеристика</th>
                  {columns.map((item) => {
                    const local = productMetaById.get(item.id);
                    const title = local?.title || item.normalized_title;
                    const slug = local?.slug || `${item.id}-${slugify(item.normalized_title)}`;
                    return (
                      <th key={item.id} className="min-w-56 px-4 py-3 text-left text-sm font-semibold">
                        <Link href={`/product/${slug}`} className="hover:text-primary">
                          {title}
                        </Link>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm text-muted-foreground">No differences found</td>
                    {columns.map((item) => (
                      <td key={item.id} className="px-4 py-3 text-sm text-muted-foreground">
                        -
                      </td>
                    ))}
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm font-medium">{row.label}</td>
                      {row.values.map((value, index) => (
                        <td
                          key={`${row.key}:${columns[index]?.id ?? index}`}
                          className={cn(
                            "px-4 py-3 text-sm text-muted-foreground",
                            row.bestCellIndexes.has(index) && "bg-emerald-50/80 font-medium text-emerald-800"
                          )}
                        >
                          {renderCellValue(row.key, value)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {history.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent comparisons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {history.slice(0, 6).map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="line-clamp-1 text-sm font-medium">{entry.items.map((item) => item.title).join(" vs ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)} | {entry.items.length} products
                    {entry.category ? ` | ${formatCategory(entry.category)}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                  Restore
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

