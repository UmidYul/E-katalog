"use client";

import { useMemo, useState } from "react";
import { Gauge, Megaphone, PauseCircle, PlayCircle, Save, StopCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useB2BAnalyticsOverview, useB2BCampaigns, useB2BMe, useCreateB2BCampaign, usePatchB2BCampaign } from "@/features/b2b/use-b2b";
import { useDynamicFilters } from "@/features/catalog/use-catalog-queries";
import { cn } from "@/lib/utils/cn";

type DraftState = {
  daily_budget: string;
  monthly_budget: string;
  bid_default: string;
  bid_cap: string;
  pacing_mode: "even" | "aggressive";
};

const toNumber = (value: string, fallback: number = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export function B2BCampaignsPage() {
  const meQuery = useB2BMe();
  const primaryOrg = useMemo(() => meQuery.data?.organizations?.[0], [meQuery.data?.organizations]);
  const orgId = primaryOrg?.id;
  const currency = primaryOrg?.default_currency ?? "UZS";

  const campaignsQuery = useB2BCampaigns(orgId);
  const analyticsQuery = useB2BAnalyticsOverview(orgId, 30);
  const dynamicFiltersQuery = useDynamicFilters();
  const createCampaignMutation = useCreateB2BCampaign(orgId);
  const patchCampaignMutation = usePatchB2BCampaign(orgId);

  const [storeId, setStoreId] = useState("");
  const [name, setName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("50000");
  const [monthlyBudget, setMonthlyBudget] = useState("1500000");
  const [bidDefault, setBidDefault] = useState("800");
  const [bidCap, setBidCap] = useState("1500");
  const [pacingMode, setPacingMode] = useState<"even" | "aggressive">("even");
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  if (meQuery.isLoading || campaignsQuery.isLoading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading campaigns...</div>;
  }

  if (meQuery.isError || campaignsQuery.isError || !meQuery.data || !orgId) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load campaign manager.
      </div>
    );
  }

  const campaigns = campaignsQuery.data ?? [];
  const stores = dynamicFiltersQuery.data?.stores ?? [];

  const activeCount = campaigns.filter((item) => item.status === "active").length;
  const pausedCount = campaigns.filter((item) => item.status === "paused").length;
  const totalDailyBudget = campaigns.reduce((sum, item) => sum + item.daily_budget, 0);
  const totalMonthlyBudget = campaigns.reduce((sum, item) => sum + item.monthly_budget, 0);
  const avgBid = campaigns.length ? campaigns.reduce((sum, item) => sum + item.bid_default, 0) / campaigns.length : 0;

  const avgCpc = Number(analyticsQuery.data?.summary?.avg_cpc ?? 0);
  const recommendedBidFloor = avgCpc > 0 ? avgCpc * 1.1 : 0;
  const recommendedBidCap = avgCpc > 0 ? avgCpc * 1.8 : 0;

  const createCampaign = () => {
    setFormMessage(null);
    if (!name.trim() || !storeId.trim()) {
      setFormMessage("Campaign name and store are required.");
      return;
    }

    createCampaignMutation.mutate(
      {
        store_id: storeId.trim(),
        name: name.trim(),
        daily_budget: toNumber(dailyBudget),
        monthly_budget: toNumber(monthlyBudget),
        bid_default: toNumber(bidDefault),
        bid_cap: toNumber(bidCap),
        pacing_mode: pacingMode,
      },
      {
        onSuccess: () => {
          setName("");
          setFormMessage("Campaign created.");
        },
        onError: () => setFormMessage("Failed to create campaign. Verify inputs."),
      },
    );
  };

  const getDraft = (campaign: (typeof campaigns)[number]): DraftState =>
    drafts[campaign.id] ?? {
      daily_budget: String(campaign.daily_budget),
      monthly_budget: String(campaign.monthly_budget),
      bid_default: String(campaign.bid_default),
      bid_cap: String(campaign.bid_cap),
      pacing_mode: (campaign.pacing_mode === "aggressive" ? "aggressive" : "even") as "even" | "aggressive",
    };

  const updateDraft = (campaignId: string, patch: Partial<DraftState>) => {
    setDrafts((current) => ({
      ...current,
      [campaignId]: {
        ...(current[campaignId] ?? {
          daily_budget: "",
          monthly_budget: "",
          bid_default: "",
          bid_cap: "",
          pacing_mode: "even",
        }),
        ...patch,
      },
    }));
  };

  const patchCampaign = (campaignId: string, patch: Parameters<typeof patchCampaignMutation.mutate>[0]) => {
    setActionMessage(null);
    patchCampaignMutation.mutate(patch, {
      onSuccess: () => setActionMessage(`Campaign ${campaignId.slice(0, 8)} updated.`),
      onError: () => setActionMessage(`Failed to update campaign ${campaignId.slice(0, 8)}.`),
    });
  };

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Paused campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{pausedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Daily budget total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{moneyFormatter.format(totalDailyBudget)} {currency}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Average bid</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{moneyFormatter.format(avgBid)} {currency}</p>
          </CardContent>
        </Card>
      </section>

      <Card className="border-sky-300/60 bg-gradient-to-br from-sky-100/55 to-cyan-100/45">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            Launch campaign
          </CardTitle>
          <div className="rounded-xl border border-sky-200/80 bg-white/80 px-3 py-2 text-xs">
            <p className="font-semibold">30d CPC recommendation</p>
            <p className="text-muted-foreground">
              floor {moneyFormatter.format(recommendedBidFloor)} / cap {moneyFormatter.format(recommendedBidCap)} {currency}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Input placeholder="Campaign name" value={name} onChange={(event) => setName(event.target.value)} />
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger>
                <SelectValue placeholder={stores.length ? "Select store" : "Store UUID"} />
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="number" placeholder="Daily budget" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} />
            <Input type="number" placeholder="Monthly budget" value={monthlyBudget} onChange={(event) => setMonthlyBudget(event.target.value)} />
            <Input type="number" placeholder="Default bid" value={bidDefault} onChange={(event) => setBidDefault(event.target.value)} />
            <Input type="number" placeholder="Bid cap" value={bidCap} onChange={(event) => setBidCap(event.target.value)} />
          </div>

          <div className="w-full sm:w-56">
            <Select value={pacingMode} onValueChange={(value) => setPacingMode(value as "even" | "aggressive")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="even">Even pacing</SelectItem>
                <SelectItem value="aggressive">Aggressive pacing</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formMessage ? <p className="text-xs text-muted-foreground">{formMessage}</p> : null}
          <Button onClick={createCampaign} disabled={createCampaignMutation.isPending}>
            {createCampaignMutation.isPending ? "Creating..." : "Create campaign"}
          </Button>
        </CardContent>
      </Card>

      {actionMessage ? <p className="text-xs text-muted-foreground">{actionMessage}</p> : null}
      <section className="space-y-3">
        {campaigns.length ? (
          campaigns.map((campaign) => {
            const draft = getDraft(campaign);
            return (
              <Card key={campaign.id} className={cn(campaign.status === "active" && "border-emerald-300/70")}>
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle className="text-base">{campaign.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-xs">{campaign.status}</span>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-xs">{campaign.pacing_mode}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Input
                      type="number"
                      value={draft.daily_budget}
                      onChange={(event) => updateDraft(campaign.id, { daily_budget: event.target.value })}
                      placeholder="Daily budget"
                    />
                    <Input
                      type="number"
                      value={draft.monthly_budget}
                      onChange={(event) => updateDraft(campaign.id, { monthly_budget: event.target.value })}
                      placeholder="Monthly budget"
                    />
                    <Input
                      type="number"
                      value={draft.bid_default}
                      onChange={(event) => updateDraft(campaign.id, { bid_default: event.target.value })}
                      placeholder="Bid default"
                    />
                    <Input
                      type="number"
                      value={draft.bid_cap}
                      onChange={(event) => updateDraft(campaign.id, { bid_cap: event.target.value })}
                      placeholder="Bid cap"
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-center">
                    <Select value={draft.pacing_mode} onValueChange={(value) => updateDraft(campaign.id, { pacing_mode: value as "even" | "aggressive" })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="even">Even pacing</SelectItem>
                        <SelectItem value="aggressive">Aggressive pacing</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      variant="secondary"
                      onClick={() =>
                        patchCampaign(campaign.id, {
                          campaignId: campaign.id,
                          daily_budget: toNumber(draft.daily_budget, campaign.daily_budget),
                          monthly_budget: toNumber(draft.monthly_budget, campaign.monthly_budget),
                          bid_default: toNumber(draft.bid_default, campaign.bid_default),
                          bid_cap: toNumber(draft.bid_cap, campaign.bid_cap),
                          pacing_mode: draft.pacing_mode,
                        })
                      }
                      disabled={patchCampaignMutation.isPending}
                    >
                      <Save className="mr-1 h-3.5 w-3.5" />
                      Save
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => patchCampaign(campaign.id, { campaignId: campaign.id, status: "active" })}
                      disabled={patchCampaignMutation.isPending}
                    >
                      <PlayCircle className="mr-1 h-3.5 w-3.5" />
                      Activate
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => patchCampaign(campaign.id, { campaignId: campaign.id, status: "paused" })}
                      disabled={patchCampaignMutation.isPending}
                    >
                      <PauseCircle className="mr-1 h-3.5 w-3.5" />
                      Pause
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => patchCampaign(campaign.id, { campaignId: campaign.id, status: "archived" })}
                      disabled={patchCampaignMutation.isPending}
                    >
                      <StopCircle className="mr-1 h-3.5 w-3.5" />
                      Archive
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1">
                      <Gauge className="h-3.5 w-3.5 text-primary" />
                      monthly budget: {moneyFormatter.format(campaign.monthly_budget)} {currency} | daily budget:{" "}
                      {moneyFormatter.format(campaign.daily_budget)} {currency}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">No campaigns yet. Create your first campaign above.</CardContent>
          </Card>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Budget pulse</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Planned monthly budget: <span className="font-semibold text-foreground">{moneyFormatter.format(totalMonthlyBudget)} {currency}</span>. Keep
          daily budget close to real traffic and update bids when 30-day CPC trend changes.
        </CardContent>
      </Card>
    </div>
  );
}
