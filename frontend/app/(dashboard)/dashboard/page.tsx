"use client";

import { DatabaseZap, Package, ShoppingCart, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminAnalytics } from "@/features/analytics/use-admin-analytics";
import { useAdminTaskStatus, useRunAdminTask } from "@/features/products/use-admin-products";
import { formatPrice } from "@/lib/utils/format";

type PipelineTask = "reindex" | "embedding" | "dedupe" | "scrape";

export default function DashboardPage() {
  const analytics = useAdminAnalytics("30d");
  const runTask = useRunAdminTask();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskType, setActiveTaskType] = useState<PipelineTask | null>(null);
  const taskStatus = useAdminTaskStatus(activeTaskId);
  const m = analytics.data;
  const progress = taskStatus.data?.progress ?? 0;
  const state = taskStatus.data?.state ?? "IDLE";
  const stateLabel = useMemo(() => {
    if (activeTaskType === "scrape") return `Scrape: ${state}`;
    if (activeTaskType === "embedding") return `Embedding: ${state}`;
    if (activeTaskType === "dedupe") return `Dedupe: ${state}`;
    if (activeTaskType === "reindex") return `Reindex: ${state}`;
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
            <div className="mt-4 space-y-2 rounded-xl border border-border p-3">
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
    </div>
  );
}
