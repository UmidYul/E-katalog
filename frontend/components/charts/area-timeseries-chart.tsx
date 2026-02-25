"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartEmptyState, ChartShell } from "@/components/charts/chart-shell";

type Row = Record<string, string | number>;

export function AreaTimeseriesChart({
  title,
  description,
  data,
  dataKey,
  xKey = "ts",
  color = "hsl(var(--primary))",
  valueFormatter,
}: {
  title: string;
  description?: string;
  data: Row[];
  dataKey: string;
  xKey?: string;
  color?: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!data.length) {
    return (
      <ChartShell title={title} description={description}>
        <ChartEmptyState />
      </ChartShell>
    );
  }

  return (
    <ChartShell title={title} description={description}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="areaPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={52} />
            <Tooltip
              formatter={(value: unknown) => {
                const numeric = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(numeric)) return ["-", dataKey];
                return [valueFormatter ? valueFormatter(numeric) : numeric.toLocaleString(), dataKey];
              }}
            />
            <Area type="monotone" dataKey={dataKey} stroke={color} fill="url(#areaPrimary)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}
