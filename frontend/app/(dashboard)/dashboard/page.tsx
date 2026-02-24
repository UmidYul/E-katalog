"use client";

import Link from "next/link";
import { DatabaseZap, Package, ShoppingCart, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useAdminAnalytics } from "@/features/analytics/use-admin-analytics";
import {
  useAdminProductsWithoutValidOffers,
  useAdminTaskStatus,
  useDeactivateProductsWithoutValidOffers,
  useRunAdminTask,
} from "@/features/products/use-admin-products";
import { formatPrice } from "@/lib/utils/format";

type PipelineTask = "reindex" | "embedding" | "dedupe" | "scrape" | "quality" | "catalog" | "quality_alert_test";
const NO_OFFER_PAGE_SIZE = 8;

const formatPercent = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${(numeric * 100).toFixed(1)}%`;
};

export default function DashboardPage() {
  const analytics = useAdminAnalytics("30d");
  const [noOfferOffset, setNoOfferOffset] = useState(0);
  const [noOfferActiveOnly, setNoOfferActiveOnly] = useState(true);
  const productsWithoutOffers = useAdminProductsWithoutValidOffers({
    limit: NO_OFFER_PAGE_SIZE,
    offset: noOfferOffset,
    active_only: noOfferActiveOnly,
  });
  const deactivateNoOfferProducts = useDeactivateProductsWithoutValidOffers();
  const runTask = useRunAdminTask();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskType, setActiveTaskType] = useState<PipelineTask | null>(null);
  const [selectedNoOfferIds, setSelectedNoOfferIds] = useState<string[]>([]);
  const [noOfferFeedback, setNoOfferFeedback] = useState<string | null>(null);
  const taskStatus = useAdminTaskStatus(activeTaskId);
  const m = analytics.data;
  const noOfferItems = productsWithoutOffers.data?.items ?? [];
  const noOfferTotal = productsWithoutOffers.data?.total ?? 0;
  const noOfferHasPrev = noOfferOffset > 0;
  const noOfferHasNext = noOfferOffset + NO_OFFER_PAGE_SIZE < noOfferTotal;
  const noOfferFrom = noOfferTotal ? noOfferOffset + 1 : 0;
  const noOfferTo = noOfferTotal ? Math.min(noOfferOffset + noOfferItems.length, noOfferTotal) : 0;
  const visibleNoOfferIds = noOfferItems.map((item) => item.id);
  const selectedVisibleNoOfferIds = selectedNoOfferIds.filter((id) => visibleNoOfferIds.includes(id));
  const selectedNoOfferCount = selectedVisibleNoOfferIds.length;
  const allNoOfferChecked = visibleNoOfferIds.length > 0 && visibleNoOfferIds.every((id) => selectedNoOfferIds.includes(id));
  const quality = m?.quality_report;
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
  const progress = taskStatus.data?.progress ?? 0;
  const state = taskStatus.data?.state ?? "IDLE";
  const stateLabel = useMemo(() => {
    if (activeTaskType === "scrape") return `Scrape: ${state}`;
    if (activeTaskType === "embedding") return `Embedding: ${state}`;
    if (activeTaskType === "dedupe") return `Dedupe: ${state}`;
    if (activeTaskType === "reindex") return `Reindex: ${state}`;
    if (activeTaskType === "quality") return `Quality check: ${state}`;
    if (activeTaskType === "catalog") return `Catalog rebuild: ${state}`;
    if (activeTaskType === "quality_alert_test") return `Quality alert test: ${state}`;
    return "No active task";
  }, [activeTaskType, state]);

  const triggerTask = (task: PipelineTask) => {
    runTask.mutate(task, {
      onSuccess: (result) => {
        setActiveTaskType(task);
        setActiveTaskId(result.data.task_id);
      },
    });
  };

  const toggleNoOfferRow = (id: string, checked: boolean) => {
    setSelectedNoOfferIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((value) => value !== id)));
  };

  const toggleAllNoOfferRows = (checked: boolean) => {
    setSelectedNoOfferIds((prev) => {
      if (!checked) return prev.filter((id) => !visibleNoOfferIds.includes(id));
      return Array.from(new Set([...prev, ...visibleNoOfferIds]));
    });
  };

  const deactivateSelectedWithoutOffers = () => {
    if (!selectedVisibleNoOfferIds.length) return;
    setNoOfferFeedback(null);
    deactivateNoOfferProducts.mutate(selectedVisibleNoOfferIds, {
      onSuccess: (result) => {
        const payload = result.data;
        setNoOfferFeedback(`Deactivated ${payload.deactivated}/${payload.requested}. Skipped: ${payload.skipped}.`);
        setSelectedNoOfferIds((prev) => prev.filter((id) => !selectedVisibleNoOfferIds.includes(id)));
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        setNoOfferFeedback(`Bulk deactivate failed: ${message}`);
      },
    });
  };

  const handleNoOfferPrev = () => {
    if (!noOfferHasPrev) return;
    setNoOfferOffset((prev) => Math.max(0, prev - NO_OFFER_PAGE_SIZE));
    setSelectedNoOfferIds([]);
    setNoOfferFeedback(null);
  };

  const handleNoOfferNext = () => {
    if (!noOfferHasNext) return;
    setNoOfferOffset((prev) => prev + NO_OFFER_PAGE_SIZE);
    setSelectedNoOfferIds([]);
    setNoOfferFeedback(null);
  };

  const handleToggleNoOfferActiveOnly = (checked: boolean) => {
    setNoOfferActiveOnly(checked);
    setNoOfferOffset(0);
    setSelectedNoOfferIds([]);
    setNoOfferFeedback(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Users" value={String(m?.total_users ?? 0)} icon={Users} />
        <StatCard title="Orders" value={String(m?.total_orders ?? 0)} icon={ShoppingCart} />
        <StatCard title="Products" value={String(m?.total_products ?? 0)} icon={Package} />
        <StatCard title="Revenue" value={formatPrice(m?.revenue ?? 0)} icon={DatabaseZap} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <MiniBarChart data={m?.trend ?? []} />
        <Card>
          <CardHeader>
            <CardTitle>Data pipeline actions</CardTitle>
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
            <Button variant="outline" className="w-full" onClick={() => triggerTask("quality_alert_test")}>
              Send quality alert test
            </Button>
            <div className="mt-4 space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{stateLabel}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Data quality</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${qualityStatusClass}`}>{qualityStatus}</span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Search mismatch: {formatPercent(qualitySummary.search_mismatch_ratio)}</p>
                <p>No valid offers: {formatPercent(qualitySummary.active_without_valid_offers_ratio)}</p>
                <p>Low-quality images: {formatPercent(qualitySummary.low_quality_image_ratio)}</p>
                {quality?.created_at ? <p>Updated: {new Date(quality.created_at).toLocaleString()}</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>Products without valid offers</CardTitle>
            <span className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-xs text-muted-foreground">
              {productsWithoutOffers.data?.total ?? "-"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={allNoOfferChecked} onCheckedChange={(checked) => toggleAllNoOfferRows(Boolean(checked))} />
              Select all
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={noOfferActiveOnly} onCheckedChange={(checked) => handleToggleNoOfferActiveOnly(Boolean(checked))} />
              Active only
            </label>
            <Button variant="secondary" size="sm" onClick={() => triggerTask("scrape")} disabled={runTask.isPending}>
              Run scrape
            </Button>
            <Button variant="ghost" size="sm" onClick={() => triggerTask("catalog")} disabled={runTask.isPending}>
              Run catalog rebuild
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={deactivateSelectedWithoutOffers}
              disabled={!selectedNoOfferCount || deactivateNoOfferProducts.isPending}
            >
              {deactivateNoOfferProducts.isPending ? "Deactivating..." : `Deactivate selected (${selectedNoOfferCount})`}
            </Button>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {noOfferFrom}-{noOfferTo} of {noOfferTotal}
              </span>
              <Button variant="ghost" size="sm" onClick={handleNoOfferPrev} disabled={!noOfferHasPrev || productsWithoutOffers.isLoading}>
                Prev
              </Button>
              <Button variant="ghost" size="sm" onClick={handleNoOfferNext} disabled={!noOfferHasNext || productsWithoutOffers.isLoading}>
                Next
              </Button>
            </div>
          </div>
          {noOfferFeedback ? <p className="text-xs text-muted-foreground">{noOfferFeedback}</p> : null}
          {productsWithoutOffers.isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
          {productsWithoutOffers.error ? <p className="text-sm text-red-600">Failed to load products without valid offers.</p> : null}
          {!productsWithoutOffers.isLoading && !productsWithoutOffers.error && !productsWithoutOffers.data?.items.length ? (
            <p className="text-sm text-emerald-700">No active products with missing valid offers.</p>
          ) : null}
          {productsWithoutOffers.data?.items?.length ? (
            <ul className="space-y-2">
              {productsWithoutOffers.data.items.map((item) => (
                <li key={item.id} className="rounded-lg border border-border p-2">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={selectedNoOfferIds.includes(item.id)}
                      onCheckedChange={(checked) => toggleNoOfferRow(item.id, Boolean(checked))}
                    />
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/products/${item.id}`} className="line-clamp-1 text-sm font-medium hover:text-primary">
                        {item.normalized_title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {item.brand?.name ?? "No brand"} | stores: {item.store_count} | offers: {item.total_offers}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last seen: {item.last_offer_seen_at ? new Date(item.last_offer_seen_at).toLocaleString() : "never"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
