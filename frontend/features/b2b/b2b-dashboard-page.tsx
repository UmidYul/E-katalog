"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  CreditCard,
  FolderSync,
  type LucideIcon,
  Megaphone,
  MessageSquareWarning,
  Wallet,
} from "lucide-react";

import { AreaTimeseriesChart } from "@/components/charts/area-timeseries-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useB2BAnalyticsOverview, useB2BCampaigns, useB2BFeeds, useB2BInvoices, useB2BMe, useB2BTickets } from "@/features/b2b/use-b2b";
import { cn } from "@/lib/utils/cn";

const PERIODS = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
] as const;

type MetricTileProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn";
  icon: LucideIcon;
};

const numberFormatter = new Intl.NumberFormat("ru-RU");
const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat("ru-RU", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2 });

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const formatMoney = (value: number, currency: string) => `${moneyFormatter.format(value)} ${currency}`;
const formatPercent = (value: number) => percentFormatter.format(Math.max(0, value));

const formatDateLabel = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
};

function MetricTile({ label, value, hint, tone = "neutral", icon: Icon }: MetricTileProps) {
  return (
    <Card
      className={cn(
        "border-slate-200/90 bg-white/95",
        tone === "good" && "border-emerald-200/90",
        tone === "warn" && "border-amber-200/90",
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium text-slate-600">
          {label}
          <Icon
            className={cn(
              "h-4 w-4",
              tone === "neutral" && "text-sky-700",
              tone === "good" && "text-emerald-600",
              tone === "warn" && "text-amber-600",
            )}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function B2BDashboardPage() {
  const [periodDays, setPeriodDays] = useState<(typeof PERIODS)[number]["value"]>(30);
  const meQuery = useB2BMe();

  const primaryOrg = useMemo(() => meQuery.data?.organizations?.[0], [meQuery.data?.organizations]);
  const orgId = primaryOrg?.id;
  const currency = primaryOrg?.default_currency ?? "UZS";

  const analyticsQuery = useB2BAnalyticsOverview(orgId, periodDays);
  const campaignsQuery = useB2BCampaigns(orgId);
  const feedsQuery = useB2BFeeds(orgId);
  const invoicesQuery = useB2BInvoices(orgId);
  const ticketsQuery = useB2BTickets(orgId);

  if (meQuery.isLoading) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading B2B dashboard...</div>;
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load B2B profile. Please refresh page.
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">B2B dashboard</h2>
        <p className="mt-2 text-sm text-slate-600">Организация еще не создана. Сначала пройдите onboarding и добавьте компанию.</p>
        <Link href="/b2b/onboarding" className="mt-4 inline-flex rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Перейти в onboarding
        </Link>
      </div>
    );
  }

  const summary = analyticsQuery.data?.summary ?? {};
  const totalClicks = toNumber(summary.total_clicks);
  const billableClicks = toNumber(summary.billable_clicks);
  const spend = toNumber(summary.spend);
  const avgCpc = toNumber(summary.avg_cpc);
  const ctr = toNumber(summary.ctr);
  const uniqueSessions = toNumber(summary.unique_sessions);

  const series = (analyticsQuery.data?.series ?? []).map((item) => {
    const row = item as Record<string, unknown>;
    return {
      label: formatDateLabel(row.ts),
      clicks: toNumber(row.clicks),
      billable_clicks: toNumber(row.billable_clicks),
      spend: toNumber(row.spend),
    };
  });

  const campaigns = campaignsQuery.data ?? [];
  const feeds = feedsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const tickets = ticketsQuery.data ?? [];

  const activeCampaigns = campaigns.filter((item) => item.status === "active").length;
  const draftCampaigns = campaigns.filter((item) => item.status === "draft").length;
  const pausedCampaigns = campaigns.filter((item) => item.status === "paused").length;

  const activeFeeds = feeds.filter((item) => item.is_active).length;
  const feedsWithValidation = feeds.filter((item) => Boolean(item.last_validated_at)).length;

  const openTickets = tickets.filter((item) => item.status === "open" || item.status === "in_progress").length;

  const outstandingAmount = invoices
    .filter((item) => item.status !== "paid" && item.status !== "void")
    .reduce((sum, item) => sum + Math.max(item.total_amount - item.paid_amount, 0), 0);
  const overdueInvoices = invoices.filter((item) => item.status === "overdue").length;

  const lastUpdate = analyticsQuery.data?.generated_at ? new Date(analyticsQuery.data.generated_at).toLocaleString("ru-RU") : "-";

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-sky-100 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-emerald-100 blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">Merchant Dashboard</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{primaryOrg.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Контроль рекламной эффективности, качества фидов и платежной дисциплины в одном кабинете.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">status: {primaryOrg.status}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                onboarding: {meQuery.data.onboarding_status_by_org[primaryOrg.id] ?? "draft"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                billing: {meQuery.data.billing_status_by_org[primaryOrg.id] ?? "inactive"}
              </span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Quick actions</p>
            <div className="mt-3 grid gap-2">
              <Link href="/b2b/campaigns" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300">
                Управлять кампаниями
              </Link>
              <Link href="/b2b/feeds" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300">
                Проверить фиды
              </Link>
              <Link href="/b2b/billing" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300">
                Оплатить счета
              </Link>
            </div>
            <p className="mt-3 text-xs text-slate-500">Last analytics sync: {lastUpdate}</p>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Аналитика</h2>
          <p className="text-sm text-slate-600">Клики, расходы и качество трафика</p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {PERIODS.map((period) => (
            <button
              key={period.value}
              type="button"
              onClick={() => setPeriodDays(period.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                periodDays === period.value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {period.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Total clicks" value={numberFormatter.format(totalClicks)} hint={`${numberFormatter.format(uniqueSessions)} unique sessions`} icon={Activity} />
        <MetricTile
          label="Billable clicks"
          value={numberFormatter.format(billableClicks)}
          hint={totalClicks > 0 ? `${((billableClicks / totalClicks) * 100).toFixed(1)}% от всех кликов` : "Нет данных"}
          tone="good"
          icon={BadgeCheck}
        />
        <MetricTile label="Spend" value={formatMoney(spend, currency)} hint="Период CPC-начислений" icon={Wallet} />
        <MetricTile label="Avg CPC" value={formatMoney(avgCpc, currency)} hint={`CTR ${formatPercent(ctr)}`} tone="warn" icon={BarChart3} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <AreaTimeseriesChart
          title="Clicks trend"
          description="Динамика кликов по дням"
          data={series}
          dataKey="clicks"
          xKey="label"
          color="#0f766e"
          valueFormatter={(value) => numberFormatter.format(value)}
        />
        <AreaTimeseriesChart
          title="Spend trend"
          description="Расходы CPC по дням"
          data={series}
          dataKey="spend"
          xKey="label"
          color="#0369a1"
          valueFormatter={(value) => formatMoney(value, currency)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200/90 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm text-slate-700">
              Campaigns
              <Megaphone className="h-4 w-4 text-sky-700" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-600">
            <div className="flex items-center justify-between"><span>Active</span><span className="font-semibold text-slate-900">{activeCampaigns}</span></div>
            <div className="flex items-center justify-between"><span>Draft</span><span className="font-semibold text-slate-900">{draftCampaigns}</span></div>
            <div className="flex items-center justify-between"><span>Paused</span><span className="font-semibold text-slate-900">{pausedCampaigns}</span></div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm text-slate-700">
              Feed health
              <FolderSync className="h-4 w-4 text-emerald-600" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-600">
            <div className="flex items-center justify-between"><span>Connected feeds</span><span className="font-semibold text-slate-900">{feeds.length}</span></div>
            <div className="flex items-center justify-between"><span>Active feeds</span><span className="font-semibold text-slate-900">{activeFeeds}</span></div>
            <div className="flex items-center justify-between"><span>Validated at least once</span><span className="font-semibold text-slate-900">{feedsWithValidation}</span></div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm text-slate-700">
              Billing risk
              <CreditCard className="h-4 w-4 text-amber-600" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-600">
            <div className="flex items-center justify-between"><span>Open invoices</span><span className="font-semibold text-slate-900">{invoices.filter((item) => item.status !== "paid" && item.status !== "void").length}</span></div>
            <div className="flex items-center justify-between"><span>Overdue invoices</span><span className="font-semibold text-slate-900">{overdueInvoices}</span></div>
            <div className="flex items-center justify-between"><span>Outstanding amount</span><span className="font-semibold text-slate-900">{formatMoney(outstandingAmount, currency)}</span></div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm text-slate-700">
              Support queue
              <MessageSquareWarning className="h-4 w-4 text-slate-700" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-600">
            <div className="flex items-center justify-between"><span>Open or in progress</span><span className="font-semibold text-slate-900">{openTickets}</span></div>
            <div className="flex items-center justify-between"><span>Total tickets</span><span className="font-semibold text-slate-900">{tickets.length}</span></div>
            <div className="flex items-center justify-between"><span>Analytics period</span><span className="font-semibold text-slate-900">{periodDays} days</span></div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
