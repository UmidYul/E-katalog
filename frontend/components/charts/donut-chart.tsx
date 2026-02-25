"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartEmptyState, ChartShell } from "@/components/charts/chart-shell";

type DonutRow = {
  name: string;
  value: number;
  color: string;
};

export function DonutChartWidget({
  title,
  description,
  data,
}: {
  title: string;
  description?: string;
  data: DonutRow[];
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
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={84} paddingAngle={2}>
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number | string) => (typeof value === "number" ? value.toLocaleString() : String(value))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center justify-between rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                <span>{entry.name}</span>
              </div>
              <span className="font-semibold">{entry.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartShell>
  );
}
