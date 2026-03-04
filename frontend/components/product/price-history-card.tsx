"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { catalogKeys, useProductPriceHistory } from "@/features/catalog/use-catalog-queries";
import { catalogApi } from "@/lib/api/openapi-client";
import { formatPrice } from "@/lib/utils/format";

const PERIODS = [30, 90, 180] as const;
type Period = (typeof PERIODS)[number];
const DEFAULT_PERIOD: Period = 30;

type HistoryPoint = {
  date: string;
  min: number;
  max: number;
};

const dayFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const compactNumberFormatter = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const formatDay = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return dayFormatter.format(date);
};

const formatCompactNumber = (value: number) => {
  if (!Number.isFinite(value)) return "-";
  return compactNumberFormatter.format(value);
};

export function PriceHistoryCard({ productId }: { productId: string }) {
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const queryClient = useQueryClient();
  const history = useProductPriceHistory(productId, period);

  useEffect(() => {
    if (!productId) return;
    for (const nextPeriod of PERIODS) {
      if (nextPeriod === DEFAULT_PERIOD) continue;
      void queryClient.prefetchQuery({
        queryKey: catalogKeys.priceHistory(productId, nextPeriod),
        queryFn: () => catalogApi.getProductPriceHistory(productId, nextPeriod),
        staleTime: 2 * 60_000,
      });
    }
  }, [productId, queryClient]);

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
          max: Number(max),
        };
      })
      .filter((point): point is HistoryPoint => point !== null)
      .sort((left, right) => left.date.localeCompare(right.date));
  }, [history.data]);

  const chart = useMemo(() => {
    if (!points.length) return null;
    return {
      minValue: Math.min(...points.map((point) => point.min)),
      maxValue: Math.max(...points.map((point) => point.max)),
      lastMin: points[points.length - 1]?.min ?? null,
      lastMax: points[points.length - 1]?.max ?? null,
    };
  }, [points]);

  const yDomain = useMemo<[number, number] | undefined>(() => {
    if (!chart) return undefined;
    const range = chart.maxValue - chart.minValue;
    const padding = Math.max(range * 0.12, 25_000);
    const min = Math.max(0, Math.floor(chart.minValue - padding));
    const max = Math.ceil(chart.maxValue + padding);
    return [min, max];
  }, [chart]);

  const isInitialLoading = history.isLoading && !chart;
  const isBackgroundLoading = history.isFetching && !isInitialLoading && Boolean(chart);

  return (
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle className="font-heading text-xl font-bold">История цены</CardTitle>
        <div className="flex gap-2">
          {PERIODS.map((item) => (
            <Button key={item} size="sm" variant={period === item ? "default" : "outline"} onClick={() => setPeriod(item)}>
              {item}d
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {history.error ? <p className="text-sm text-destructive">Не удалось загрузить историю цен.</p> : null}

        {isInitialLoading ? <div className="h-64 animate-pulse rounded-xl border border-border/80 bg-muted/20" /> : null}

        {!isInitialLoading && !history.error && !chart ? (
          <p className="text-sm text-muted-foreground">История пока пустая. Данные появятся после нескольких обновлений цен.</p>
        ) : null}

        {chart ? (
          <>
            <div className="relative h-64 overflow-hidden rounded-xl border border-border/80 bg-gradient-to-b from-background to-muted/20 px-2 py-3">
              {isBackgroundLoading ? (
                <div className="absolute right-3 top-3 z-10 rounded-full border border-border bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm">
                  Обновляем...
                </div>
              ) : null}

              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 12, left: 2, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDay}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    domain={yDomain ?? ["auto", "auto"]}
                    tickFormatter={(value) => formatCompactNumber(Number(value))}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    cursor={{ stroke: "hsl(var(--border))", strokeDasharray: "4 4" }}
                    labelFormatter={(label) => formatDay(String(label))}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                    }}
                    formatter={(value: number | string, name: string) => {
                      const numeric = typeof value === "number" ? value : Number(value);
                      return [Number.isFinite(numeric) ? formatPrice(numeric) : "-", name];
                    }}
                  />
                  <Legend verticalAlign="top" height={26} iconType="circle" wrapperStyle={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }} />
                  <Line type="monotone" dataKey="max" name="Максимум" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="min" name="Минимум" stroke="hsl(var(--success))" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Минимум ({period}д)</p>
                <p className="text-sm font-semibold">{formatPrice(chart.minValue)}</p>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Максимум ({period}д)</p>
                <p className="text-sm font-semibold">{formatPrice(chart.maxValue)}</p>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Последний минимум</p>
                <p className="text-sm font-semibold">{chart.lastMin != null ? formatPrice(chart.lastMin) : "-"}</p>
              </div>
              <div className="rounded-xl border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Последний максимум</p>
                <p className="text-sm font-semibold">{chart.lastMax != null ? formatPrice(chart.lastMax) : "-"}</p>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
