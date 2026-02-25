"use client";

import Link from "next/link";
import { Bell, DatabaseZap, Package, ShoppingCart, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { AreaTimeseriesChart } from "@/components/charts/area-timeseries-chart";
import { DonutChartWidget } from "@/components/charts/donut-chart";
import { MultiLineChartWidget } from "@/components/charts/line-multi-chart";
import { StackedBarChartWidget } from "@/components/charts/stacked-bar-chart";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  useAcknowledgeAdminAlert,
  useAdminAlertEvents,
  useAdminOverviewAnalytics,
  useResolveAdminAlert,
} from "@/features/analytics/use-admin-analytics";
import { useAdminProductsWithoutValidOffers, useAdminTaskStatus, useRunAdminTask } from "@/features/products/use-admin-products";
import { formatPrice } from "@/lib/utils/format";

type PipelineTask = "reindex" | "embedding" | "dedupe" | "scrape" | "quality" | "catalog" | "quality_alert_test";

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function DashboardPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "365d">("30d");
  const overview = useAdminOverviewAnalytics(period);
  const alerts = useAdminAlertEvents({ status: "open", limit: 6, offset: 0, refresh: true });
  const runTask = useRunAdminTask();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskType, setActiveTaskType] = useState<PipelineTask | null>(null);
  const taskStatus = useAdminTaskStatus(activeTaskId);
  const ackAlert = useAcknowledgeAdminAlert();
  const resolveAlert = useResolveAdminAlert();
  const productsWithoutOffers = useAdminProductsWithoutValidOffers({ limit: 6, offset: 0, active_only: true });

  const data = overview.data;
  const progress = taskStatus.data?.progress ?? 0;
  const state = taskStatus.data?.state ?? "IDLE";
  const stateLabel = useMemo(() => {
    if (activeTaskType === "scrape") return `Scrape: ${state}`;
    if (activeTaskType === "embedding") return `Embedding: ${state}`;
    if (activeTaskType === "dedupe") return `Dedupe: ${state}`;
    if (activeTaskType === "reindex") return `Reindex: ${state}`;
    if (activeTaskType === "quality") return `Quality: ${state}`;
    if (activeTaskType === "catalog") return `Catalog rebuild: ${state}`;
    if (activeTaskType === "quality_alert_test") return `Quality alert test: ${state}`;
    return "Нет активной задачи";
  }, [activeTaskType, state]);

  const triggerTask = (task: PipelineTask) => {
    runTask.mutate(task, {
      onSuccess: (result) => {
        setActiveTaskType(task);
        setActiveTaskId(result.data.task_id);
      },
    });
  };

  const statusDonut = (data?.orders_by_status ?? []).map((item, index) => ({
    name: item.status,
    value: item.count,
    color: ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#94a3b8"][index % 5] ?? "#94a3b8",
  }));

  return (
    <div className="space-y-4">
      <RadioGroup
        value={period}
        onValueChange={(value) => setPeriod(value as typeof period)}
        options={[
          { label: "7d", value: "7d" },
          { label: "30d", value: "30d" },
          { label: "90d", value: "90d" },
          { label: "365d", value: "365d" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard title="Выручка" value={formatPrice(data?.kpis.revenue ?? 0)} icon={DatabaseZap} />
        <StatCard title="Заказы" value={String(data?.kpis.orders ?? 0)} icon={ShoppingCart} />
        <StatCard title="Средний чек" value={formatPrice(data?.kpis.aov ?? 0)} icon={Bell} />
        <StatCard title="Активные товары" value={String(data?.kpis.active_products ?? 0)} icon={Package} />
        <StatCard title="Риск качества" value={formatPercent(data?.kpis.quality_risk_ratio ?? 0)} icon={Package} />
        <StatCard title="Pending модерация" value={String(data?.kpis.moderation_pending ?? 0)} icon={Users} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AreaTimeseriesChart
          title="Выручка по дням"
          description="GMV за выбранный период"
          data={(data?.revenue_series ?? []) as Array<Record<string, string | number>>}
          dataKey="value"
          valueFormatter={(value) => formatPrice(value)}
        />
        <DonutChartWidget title="Статусы заказов" description="Распределение по статусам" data={statusDonut} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <MultiLineChartWidget
          title="Тренд качества каталога"
          description="Ключевые риски качества"
          data={(data?.quality_series ?? []) as Array<Record<string, string | number>>}
          lines={[
            { key: "active_without_valid_offers_ratio", label: "Без валидных офферов", color: "#ef4444" },
            { key: "search_mismatch_ratio", label: "Search mismatch", color: "#f59e0b" },
            { key: "low_quality_image_ratio", label: "Плохие изображения", color: "#0ea5e9" },
          ]}
          valueFormatter={(value) => formatPercent(value)}
        />
        <StackedBarChartWidget
          title="Динамика модерации"
          description="Pending / Published / Rejected"
          data={(data?.moderation_series ?? []) as Array<Record<string, string | number>>}
          bars={[
            { key: "pending", label: "Pending", color: "#f59e0b" },
            { key: "published", label: "Published", color: "#22c55e" },
            { key: "rejected", label: "Rejected", color: "#ef4444" },
          ]}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Инциденты и алерты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.data?.items?.length ? (
              alerts.data.items.map((item) => (
                <div key={item.id} className="rounded-xl border border-border p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <span className="rounded-full border border-border bg-secondary/70 px-2 py-0.5 text-[11px] uppercase text-muted-foreground">
                      {item.severity}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.code} | value: {item.metric_value.toFixed(4)} | threshold: {item.threshold_value.toFixed(4)}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" disabled={ackAlert.isPending} onClick={() => ackAlert.mutate(item.id)}>
                      Ack
                    </Button>
                    <Button size="sm" variant="outline" disabled={resolveAlert.isPending} onClick={() => resolveAlert.mutate(item.id)}>
                      Resolve
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Открытых алертов нет.</p>
            )}
            <Link href="/dashboard/analytics" className="inline-block text-xs text-primary hover:underline">
              Открыть Analytics Center
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Операционные действия</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button className="w-full" onClick={() => triggerTask("scrape")}>
              Run scrape
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => triggerTask("embedding")}>
              Rebuild embeddings
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => triggerTask("dedupe")}>
              Run dedupe
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => triggerTask("reindex")}>
              Reindex search
            </Button>
            <Button variant="outline" className="w-full" onClick={() => triggerTask("quality")}>
              Run quality check
            </Button>
            <Button variant="outline" className="w-full" onClick={() => triggerTask("catalog")}>
              Run catalog rebuild
            </Button>
            <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{stateLabel}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Товары без валидных офферов</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {productsWithoutOffers.data?.items?.length ? (
            productsWithoutOffers.data.items.map((item) => (
              <div key={item.id} className="rounded-xl border border-border p-3">
                <Link href={`/dashboard/products/${item.id}`} className="line-clamp-1 text-sm font-medium hover:text-primary">
                  {item.normalized_title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {item.brand?.name ?? "Без бренда"} | stores: {item.store_count} | offers: {item.total_offers}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Критичных позиций сейчас нет.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
