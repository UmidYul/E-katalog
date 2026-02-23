"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProductPriceHistory } from "@/features/catalog/use-catalog-queries";
import { formatPrice } from "@/lib/utils/format";

const PERIODS = [30, 90, 180] as const;
type Period = (typeof PERIODS)[number];

type HistoryPoint = {
  date: string;
  min: number;
  max: number;
};

const formatDay = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
};

const buildChartPoints = (points: HistoryPoint[]) => {
  const width = 680;
  const height = 220;
  const paddingX = 28;
  const paddingY = 18;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  const minValue = Math.min(...points.map((point) => point.min));
  const maxValue = Math.max(...points.map((point) => point.max));
  const span = Math.max(maxValue - minValue, 1);

  const x = (index: number) => {
    if (points.length <= 1) return width / 2;
    return paddingX + (index / (points.length - 1)) * chartWidth;
  };
  const y = (price: number) => paddingY + ((maxValue - price) / span) * chartHeight;

  const minPolyline = points.map((point, index) => `${x(index)},${y(point.min)}`).join(" ");
  const maxPolyline = points.map((point, index) => `${x(index)},${y(point.max)}`).join(" ");

  return {
    width,
    height,
    minValue,
    maxValue,
    minPolyline,
    maxPolyline,
    lastMin: points[points.length - 1]?.min ?? null,
    lastMax: points[points.length - 1]?.max ?? null,
    firstLabel: formatDay(points[0]?.date ?? ""),
    lastLabel: formatDay(points[points.length - 1]?.date ?? "")
  };
};

export function PriceHistoryCard({ productId }: { productId: string }) {
  const [period, setPeriod] = useState<Period>(30);
  const history = useProductPriceHistory(productId, period);

  const points = useMemo<HistoryPoint[]>(() => {
    const source = history.data ?? [];
    return source
      .map((point) => {
        const min = point.min_price ?? point.max_price;
        const max = point.max_price ?? point.min_price;
        if (min == null || max == null) return null;
        return {
          date: point.date,
          min: Number(min),
          max: Number(max)
        };
      })
      .filter((point): point is HistoryPoint => point !== null)
      .sort((left, right) => left.date.localeCompare(right.date));
  }, [history.data]);

  const chart = useMemo(() => {
    if (!points.length) return null;
    return buildChartPoints(points);
  }, [points]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle>Price history</CardTitle>
        <div className="flex gap-2">
          {PERIODS.map((item) => (
            <Button key={item} size="sm" variant={period === item ? "default" : "outline"} onClick={() => setPeriod(item)}>
              {item}d
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {history.isLoading ? <p className="text-sm text-muted-foreground">Loading history...</p> : null}
        {history.error ? <p className="text-sm text-destructive">Failed to load price history.</p> : null}
        {!history.isLoading && !history.error && !chart ? (
          <p className="text-sm text-muted-foreground">No history yet. It will appear after a few price snapshots.</p>
        ) : null}
        {chart ? (
          <>
            <div className="rounded-xl border border-border/80 bg-muted/20 p-3">
              <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-56 w-full">
                {[0, 1, 2, 3, 4].map((step) => {
                  const y = 18 + ((220 - 36) / 4) * step;
                  return <line key={step} x1={28} x2={652} y1={y} y2={y} stroke="rgba(148,163,184,0.18)" strokeWidth="1" />;
                })}
                <polyline fill="none" stroke="#38bdf8" strokeWidth="3" points={chart.maxPolyline} strokeLinecap="round" />
                <polyline fill="none" stroke="#22c55e" strokeWidth="3" points={chart.minPolyline} strokeLinecap="round" />
              </svg>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{chart.firstLabel}</span>
                <span>{chart.lastLabel}</span>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Lowest ({period}d)</p>
                <p className="text-sm font-semibold">{formatPrice(chart.minValue)}</p>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Highest ({period}d)</p>
                <p className="text-sm font-semibold">{formatPrice(chart.maxValue)}</p>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Latest min</p>
                <p className="text-sm font-semibold">{chart.lastMin != null ? formatPrice(chart.lastMin) : "-"}</p>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Latest max</p>
                <p className="text-sm font-semibold">{chart.lastMax != null ? formatPrice(chart.lastMax) : "-"}</p>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

