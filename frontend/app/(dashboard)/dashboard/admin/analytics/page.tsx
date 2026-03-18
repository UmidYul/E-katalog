"use client";

import { useMutation } from "@tanstack/react-query";
import { Activity, AlertTriangle, BarChart3, Clock3, DatabaseZap, Package, ShieldAlert, ShoppingCart, Users } from "lucide-react";
import { useState } from "react";

import { AreaTimeseriesChart } from "@/components/charts/area-timeseries-chart";
import { DonutChartWidget } from "@/components/charts/donut-chart";
import { MultiLineChartWidget } from "@/components/charts/line-multi-chart";
import { StackedBarChartWidget } from "@/components/charts/stacked-bar-chart";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAcknowledgeAdminAlert,
  useAdminAlertEvents,
  useAdminCatalogQualityAnalytics,
  useAdminModerationAnalytics,
  useAdminOperationsAnalytics,
  useAdminRevenueAnalytics,
  useAdminUsersAnalytics,
  useResolveAdminAlert,
} from "@/features/analytics/use-admin-analytics";
import { adminApi } from "@/lib/api/openapi-client";
import { filterAlertEvents, toDonutRows } from "@/lib/utils/admin-analytics";
import { formatPrice } from "@/lib/utils/format";
import type { AlertSource, AlertStatus, AnalyticsPeriod, Severity } from "@/types/admin";

const colorSet = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#64748b"];
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function AdminAnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [alertStatus, setAlertStatus] = useState<AlertStatus>("open");
  const [alertSeverity, setAlertSeverity] = useState<Severity | "all">("all");
  const [alertSource, setAlertSource] = useState<AlertSource | "all">("all");

  const revenue = useAdminRevenueAnalytics(period, granularity);
  const quality = useAdminCatalogQualityAnalytics(period);
  const operations = useAdminOperationsAnalytics(period);
  const moderation = useAdminModerationAnalytics(period);
  const users = useAdminUsersAnalytics(period);
  const alerts = useAdminAlertEvents({
    status: alertStatus,
    severity: alertSeverity === "all" ? undefined : alertSeverity,
    source: alertSource === "all" ? undefined : alertSource,
    limit: 100,
    offset: 0,
    refresh: alertStatus === "open",
  });

  const ackAlert = useAcknowledgeAdminAlert();
  const resolveAlert = useResolveAdminAlert();
  const evaluateAlerts = useMutation({
    mutationFn: async () => (await adminApi.runAnalyticsAlertEvaluation()).data,
    onSuccess: async () => {
      await alerts.refetch();
    },
  });

  const revenueStatusDonut = toDonutRows(
    (revenue.data?.orders_by_status ?? []).map((item) => ({ name: item.status, value: item.count })),
    colorSet,
  );
  const moderationStatusDonut = toDonutRows(
    Object.entries(moderation.data?.status_counts ?? {}).map(([status, value]) => ({ name: status, value })),
    colorSet,
  );
  const filteredAlerts = filterAlertEvents(alerts.data?.items ?? [], {
    status: alertStatus,
    severity: alertSeverity,
    source: alertSource,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RadioGroup
          value={period}
          onValueChange={(value) => setPeriod(value as AnalyticsPeriod)}
          options={[
            { label: "7d", value: "7d" },
            { label: "30d", value: "30d" },
            { label: "90d", value: "90d" },
            { label: "365d", value: "365d" },
          ]}
        />
        <div className="w-[150px]">
          <Select value={granularity} onValueChange={(value) => setGranularity(value as "day" | "week")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">По дням</SelectItem>
              <SelectItem value="week">По неделям</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="quality">Catalog Quality</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="moderation">Moderation</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="GMV" value={formatPrice(revenue.data?.summary.revenue ?? 0)} icon={DatabaseZap} />
            <StatCard title="Orders" value={String(revenue.data?.summary.orders ?? 0)} icon={ShoppingCart} />
            <StatCard title="AOV" value={formatPrice(revenue.data?.summary.aov ?? 0)} icon={BarChart3} />
            <StatCard title="Cancel rate" value={formatPercent(revenue.data?.summary.cancel_rate ?? 0)} icon={AlertTriangle} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <AreaTimeseriesChart
              title="Revenue trend"
              description="Выручка за выбранный период"
              data={(revenue.data?.series ?? []) as Array<Record<string, string | number>>}
              dataKey="revenue"
              valueFormatter={(value) => formatPrice(value)}
            />
            <DonutChartWidget title="Orders by status" description="Статусы заказов" data={revenueStatusDonut} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Top stores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(revenue.data?.top_stores ?? []).map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                    <span>{item.name}</span>
                    <span className="font-semibold">{formatPrice(item.revenue_proxy)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top categories</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(revenue.data?.top_categories ?? []).map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                    <span>{item.name}</span>
                    <span className="font-semibold">{formatPrice(item.revenue_proxy)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top brands</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(revenue.data?.top_brands ?? []).map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                    <span>{item.name}</span>
                    <span className="font-semibold">{formatPrice(item.revenue_proxy)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="quality" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="No valid offers" value={formatPercent(quality.data?.summary.active_without_valid_offers_ratio ?? 0)} icon={ShieldAlert} />
            <StatCard title="Search mismatch" value={formatPercent(quality.data?.summary.search_mismatch_ratio ?? 0)} icon={AlertTriangle} />
            <StatCard title="Stale offers" value={formatPercent(quality.data?.summary.stale_offer_ratio ?? 0)} icon={Clock3} />
            <StatCard title="Low quality image" value={formatPercent(quality.data?.summary.low_quality_image_ratio ?? 0)} icon={Package} />
          </div>
          <MultiLineChartWidget
            title="Quality timeline"
            description="Тренд ключевых quality-метрик"
            data={(quality.data?.timeline ?? []) as Array<Record<string, string | number>>}
            lines={[
              { key: "active_without_valid_offers_ratio", label: "No valid offers", color: "#ef4444" },
              { key: "search_mismatch_ratio", label: "Search mismatch", color: "#f59e0b" },
              { key: "low_quality_image_ratio", label: "Low quality images", color: "#0ea5e9" },
            ]}
            valueFormatter={(value) => formatPercent(value)}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Breakdown by category</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(quality.data?.no_valid_offer_breakdown ?? []).map((item) => (
                  <div key={item.category_id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                    <span>{item.category_name}</span>
                    <span className="font-semibold">{item.products}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Problem products</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(quality.data?.problem_products ?? []).map((item) => (
                  <div key={item.id} className="rounded-xl border border-border px-3 py-2">
                    <p className="line-clamp-1 text-sm font-medium">{item.normalized_title}</p>
                    <p className="text-xs text-muted-foreground">
                      stores: {item.store_count} | offers: {item.total_offers}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="operations" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Runs total" value={String(operations.data?.summary.runs_total ?? 0)} icon={Activity} />
            <StatCard title="Success rate" value={formatPercent(operations.data?.summary.success_rate ?? 0)} icon={BarChart3} />
            <StatCard title="Failed 24h" value={formatPercent(operations.data?.summary.failed_task_rate_24h ?? 0)} icon={AlertTriangle} />
            <StatCard
              title="Active sources"
              value={`${operations.data?.summary.active_sources ?? 0}/${operations.data?.summary.total_sources ?? 0}`}
              icon={DatabaseZap}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <AreaTimeseriesChart
              title="Avg duration"
              description="Средняя длительность crawl-задач"
              data={(operations.data?.duration_series ?? []) as Array<Record<string, string | number>>}
              dataKey="avg_duration_sec"
              valueFormatter={(value) => `${Math.round(value)}s`}
            />
            <DonutChartWidget
              title="Runs by status"
              description="Статусы pipeline-запусков"
              data={(operations.data?.status_breakdown ?? []).map((item, index) => ({
                name: item.status,
                value: item.count,
                color: colorSet[index % colorSet.length] ?? "#64748b",
              }))}
            />
          </div>
        </TabsContent>

        <TabsContent value="moderation" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Total queue" value={String(moderation.data?.summary.total ?? 0)} icon={Users} />
            <StatCard title="Pending" value={String(moderation.data?.summary.pending ?? 0)} icon={AlertTriangle} />
            <StatCard title="Throughput 24h" value={String(moderation.data?.summary.throughput_24h ?? 0)} icon={Activity} />
            <StatCard title="Median moderation" value={`${Math.round(moderation.data?.summary.median_moderation_minutes ?? 0)}m`} icon={Clock3} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <StackedBarChartWidget
              title="Moderation series"
              description="Published/Pending/Rejected динамика"
              data={(moderation.data?.series ?? []) as Array<Record<string, string | number>>}
              bars={[
                { key: "pending", label: "Pending", color: "#f59e0b" },
                { key: "published", label: "Published", color: "#22c55e" },
                { key: "rejected", label: "Rejected", color: "#ef4444" },
              ]}
            />
            <DonutChartWidget title="Status split" description="Распределение модерации" data={moderationStatusDonut} />
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Total users" value={String(users.data?.summary.total_users ?? 0)} icon={Users} />
            <StatCard title="New users" value={String(users.data?.summary.new_users ?? 0)} icon={Activity} />
            <StatCard title="Active 30d" value={String(users.data?.summary.active_users_30d ?? 0)} icon={BarChart3} />
            <StatCard title="Inactive 30d" value={String(users.data?.summary.inactive_users_30d ?? 0)} icon={AlertTriangle} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <AreaTimeseriesChart
              title="New users trend"
              description="Регистрации за период"
              data={(users.data?.created_series ?? []) as Array<Record<string, string | number>>}
              dataKey="value"
            />
            <AreaTimeseriesChart
              title="Activity trend"
              description="Активность по last_seen"
              data={(users.data?.activity_series ?? []) as Array<Record<string, string | number>>}
              dataKey="value"
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Role distribution</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {(users.data?.role_distribution ?? []).map((item) => (
                <div key={item.role} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                  <span>{item.role}</span>
                  <span className="font-semibold">{item.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-[160px]">
              <Select value={alertStatus} onValueChange={(value) => setAlertStatus(value as AlertStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="ack">Ack</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[170px]">
              <Select value={alertSeverity} onValueChange={(value) => setAlertSeverity(value as Severity | "all")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[200px]">
              <Select value={alertSource} onValueChange={(value) => setAlertSource(value as AlertSource | "all")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="revenue">Revenue</SelectItem>
                  <SelectItem value="catalog_quality">Catalog quality</SelectItem>
                  <SelectItem value="operations">Operations</SelectItem>
                  <SelectItem value="moderation">Moderation</SelectItem>
                  <SelectItem value="users">Users</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" onClick={() => evaluateAlerts.mutate()} disabled={evaluateAlerts.isPending}>
              {evaluateAlerts.isPending ? "Запуск..." : "Evaluate alerts"}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Alert Center</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredAlerts.length ? (
                filteredAlerts.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <div className="flex items-center gap-2 text-[11px] uppercase">
                        <span className="rounded-full border border-border bg-secondary/70 px-2 py-0.5 text-muted-foreground">{item.source}</span>
                        <span className="rounded-full border border-border bg-secondary/70 px-2 py-0.5 text-muted-foreground">{item.severity}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {item.code} | value: {item.metric_value.toFixed(4)} | threshold: {item.threshold_value.toFixed(4)}
                    </p>
                    <p className="text-xs text-muted-foreground">Created: {new Date(item.created_at).toLocaleString()}</p>
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
                <p className="text-sm text-muted-foreground">События по фильтру не найдены.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

