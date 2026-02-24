"use client";

import { useState } from "react";

import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { StatCard } from "@/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup } from "@/components/ui/radio-group";
import { useAdminAnalytics } from "@/features/analytics/use-admin-analytics";
import { formatPrice } from "@/lib/utils/format";
import { BarChart3, Package, ShoppingCart, Users } from "lucide-react";

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed);
};

const formatPercent = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${(numeric * 100).toFixed(1)}%`;
};

export default function AdminAnalyticsPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "365d">("30d");
  const analytics = useAdminAnalytics(period);
  const quality = analytics.data?.quality_report;
  const qualityStatus = String(quality?.status ?? "unknown").toLowerCase();
  const qualityStatusClass =
    qualityStatus === "critical"
      ? "border-red-400/50 bg-red-100/70 text-red-700"
      : qualityStatus === "warning"
        ? "border-amber-400/50 bg-amber-100/70 text-amber-700"
        : qualityStatus === "ok"
          ? "border-emerald-400/50 bg-emerald-100/70 text-emerald-700"
          : "border-border bg-secondary/60 text-muted-foreground";
  const qualitySummary = (quality?.summary ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-4">
      <RadioGroup
        value={period}
        onValueChange={setPeriod}
        options={[
          { label: "7d", value: "7d" },
          { label: "30d", value: "30d" },
          { label: "90d", value: "90d" },
          { label: "365d", value: "365d" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Users" value={String(analytics.data?.total_users ?? 0)} icon={Users} />
        <StatCard title="Orders" value={String(analytics.data?.total_orders ?? 0)} icon={ShoppingCart} />
        <StatCard title="Products" value={String(analytics.data?.total_products ?? 0)} icon={Package} />
        <StatCard title="Revenue" value={formatPrice(analytics.data?.revenue ?? 0)} icon={BarChart3} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr_1fr]">
        <MiniBarChart data={analytics.data?.trend ?? []} />
        <Card>
          <CardHeader>
            <CardTitle>Data quality</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Latest report</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${qualityStatusClass}`}>{qualityStatus}</span>
            </div>
            <p className="text-xs text-muted-foreground">Search mismatch: {formatPercent(qualitySummary.search_mismatch_ratio)}</p>
            <p className="text-xs text-muted-foreground">No valid offers: {formatPercent(qualitySummary.active_without_valid_offers_ratio)}</p>
            <p className="text-xs text-muted-foreground">Low-quality images: {formatPercent(qualitySummary.low_quality_image_ratio)}</p>
            {quality?.created_at ? <p className="text-xs text-muted-foreground">Updated: {formatDateTime(quality.created_at)}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(analytics.data?.recent_activity ?? []).map((item) => (
              <div key={item.id} className="rounded-xl border border-border p-3 text-sm">
                <p>{item.title}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(item.timestamp)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
