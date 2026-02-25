"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartEmptyState, ChartShell } from "@/components/charts/chart-shell";

type Row = Record<string, string | number>;

export function MultiLineChartWidget({
  title,
  description,
  data,
  lines,
  xKey = "ts",
  valueFormatter,
}: {
  title: string;
  description?: string;
  data: Row[];
  lines: Array<{ key: string; label: string; color: string }>;
  xKey?: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!data.length || !lines.length) {
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
          <LineChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={50} />
            <Tooltip
              formatter={(value: unknown) => {
                const numeric = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(numeric)) return "-";
                return valueFormatter ? valueFormatter(numeric) : numeric.toLocaleString();
              }}
            />
            <Legend />
            {lines.map((line) => (
              <Line key={line.key} type="monotone" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}
