"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, Clock4, RefreshCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDynamicFilters } from "@/features/catalog/use-catalog-queries";
import { useB2BFeedRuns, useB2BFeeds, useB2BMe, useCreateB2BFeed, useValidateB2BFeed } from "@/features/b2b/use-b2b";
import { cn } from "@/lib/utils/cn";

const cronPresets = [
  { label: "Every 2 hours", value: "0 */2 * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
];

export function B2BFeedsPage() {
  const meQuery = useB2BMe();
  const primaryOrgId = useMemo(() => meQuery.data?.organizations?.[0]?.id, [meQuery.data?.organizations]);
  const feedsQuery = useB2BFeeds(primaryOrgId);
  const dynamicFiltersQuery = useDynamicFilters();
  const createFeedMutation = useCreateB2BFeed(primaryOrgId);
  const validateFeedMutation = useValidateB2BFeed(primaryOrgId);

  const [selectedFeedId, setSelectedFeedId] = useState<string>("");
  const [storeId, setStoreId] = useState("");
  const [sourceType, setSourceType] = useState("xml");
  const [sourceUrl, setSourceUrl] = useState("");
  const [scheduleCron, setScheduleCron] = useState("0 */6 * * *");
  const [isActive, setIsActive] = useState(true);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const feedRunsQuery = useB2BFeedRuns(selectedFeedId, primaryOrgId);
  const feeds = feedsQuery.data ?? [];

  useEffect(() => {
    if (!selectedFeedId && feeds.length) {
      setSelectedFeedId(feeds[0]?.id ?? "");
    }
  }, [selectedFeedId, feeds]);

  if (meQuery.isLoading || feedsQuery.isLoading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading feed manager...</div>;
  }

  if (meQuery.isError || feedsQuery.isError) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load feed management data.
      </div>
    );
  }

  const stores = dynamicFiltersQuery.data?.stores ?? [];
  const activeFeeds = feeds.filter((feed) => feed.is_active).length;
  const pausedOrErrorFeeds = feeds.filter((feed) => !feed.is_active || feed.status === "error").length;
  const validatedFeeds = feeds.filter((feed) => Boolean(feed.last_validated_at)).length;

  const createFeed = () => {
    setFormMessage(null);
    if (!storeId.trim() || !sourceUrl.trim()) {
      setFormMessage("Store and feed URL are required.");
      return;
    }
    createFeedMutation.mutate(
      {
        store_id: storeId.trim(),
        source_type: sourceType,
        source_url: sourceUrl.trim(),
        schedule_cron: scheduleCron.trim(),
        is_active: isActive,
      },
      {
        onSuccess: (result) => {
          setSelectedFeedId(result.id);
          setSourceUrl("");
          setFormMessage("Feed connected successfully.");
        },
        onError: () => setFormMessage("Failed to create feed. Verify store ID and URL."),
      },
    );
  };

  const runs = feedRunsQuery.data ?? [];
  const latestRun = runs[0];
  const latestRunHealth = latestRun && latestRun.total_items > 0 ? Math.round(((latestRun.processed_items - latestRun.rejected_items) / latestRun.total_items) * 100) : null;

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-3">
        <Card className="border-emerald-300/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active feeds</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{activeFeeds}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-300/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{pausedOrErrorFeeds}</p>
          </CardContent>
        </Card>
        <Card className="border-sky-300/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Validated at least once</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{validatedFeeds}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Connect new feed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Store</p>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder={stores.length ? "Select store" : "Paste store UUID manually below"} />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Source type</p>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xml">XML</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Input placeholder="Store UUID (if not listed)" value={storeId} onChange={(event) => setStoreId(event.target.value)} />
          <Input placeholder="Feed source URL" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Schedule</p>
              <Select value={scheduleCron} onValueChange={setScheduleCron}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cronPresets.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Cron expression" value={scheduleCron} onChange={(event) => setScheduleCron(event.target.value)} />
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Checkbox checked={isActive} onCheckedChange={setIsActive} />
            Activate feed right after creation
          </div>

          {formMessage ? <p className="text-xs text-muted-foreground">{formMessage}</p> : null}
          <Button onClick={createFeed} disabled={createFeedMutation.isPending}>
            {createFeedMutation.isPending ? "Connecting..." : "Connect feed"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Feed inventory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {feeds.length ? (
              feeds.map((feed) => {
                const active = selectedFeedId === feed.id;
                return (
                  <article
                    key={feed.id}
                    className={cn(
                      "rounded-xl border p-3 transition",
                      active ? "border-primary bg-primary/5" : "border-border/70 bg-background/60",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" className="text-left" onClick={() => setSelectedFeedId(feed.id)}>
                        <p className="text-sm font-semibold">{feed.source_type.toUpperCase()} feed</p>
                        <p className="text-xs text-muted-foreground">{feed.id}</p>
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{feed.status}</span>
                        <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{feed.is_active ? "active" : "inactive"}</span>
                      </div>
                    </div>
                    <p className="mt-2 break-all text-xs text-muted-foreground">{feed.source_url}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => validateFeedMutation.mutate(feed.id)}
                        disabled={validateFeedMutation.isPending}
                      >
                        <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                        Validate now
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        last check: {feed.last_validated_at ? new Date(feed.last_validated_at).toLocaleString("ru-RU") : "never"}
                      </span>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">No feeds connected yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {selectedFeedId ? (
              <>
                <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <p className="text-xs text-muted-foreground">Selected feed</p>
                  <p className="mt-1 break-all text-xs">{selectedFeedId}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <p className="flex items-center gap-1">
                      <Activity className="h-3.5 w-3.5 text-primary" />
                      runs: {runs.length}
                    </p>
                    <p className="flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      health: {latestRunHealth !== null ? `${latestRunHealth}%` : "-"}
                    </p>
                  </div>
                </div>

                {feedRunsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading runs...</p> : null}
                {runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{run.status}</span>
                      <span className="text-muted-foreground">{run.id}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-muted-foreground">
                      <span>total: {run.total_items}</span>
                      <span>processed: {run.processed_items}</span>
                      <span>rejected: {run.rejected_items}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock4 className="h-3.5 w-3.5" />
                        {run.finished_at ? new Date(run.finished_at).toLocaleString("ru-RU") : "running"}
                      </span>
                    </div>
                    {run.error_summary ? (
                      <p className="mt-2 flex items-start gap-1 text-amber-700">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {run.error_summary}
                      </p>
                    ) : null}
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select feed to inspect validation runs.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
