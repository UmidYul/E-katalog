"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartEmptyState, ChartShell } from "@/components/charts/chart-shell";

type Row = Record<string, string | number>;

export function StackedBarChartWidget({
  title,
  description,
  data,
  bars,
  xKey = "ts",
}: {
  title: string;
  description?: string;
  data: Row[];
  bars: Array<{ key: string; label: string; color: string }>;
  xKey?: string;
}) {
  if (!data.length || !bars.length) {
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
          <BarChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={48} />
            <Tooltip />
            <Legend />
            {bars.map((bar) => (
              <Bar key={bar.key} dataKey={bar.key} name={bar.label} fill={bar.color} stackId="stack" radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}
