"use client";

import { useMemo } from "react";

import { useB2BCampaigns, useB2BMe } from "@/features/b2b/use-b2b";

export function B2BCampaignsPage() {
  const meQuery = useB2BMe();
  const primaryOrgId = useMemo(() => meQuery.data?.organizations?.[0]?.id, [meQuery.data?.organizations]);
  const campaignsQuery = useB2BCampaigns(primaryOrgId);

  if (meQuery.isLoading || campaignsQuery.isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading campaigns...</div>;
  }

  if (meQuery.isError || campaignsQuery.isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load campaigns.
      </div>
    );
  }

  const campaigns = campaignsQuery.data ?? [];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Campaigns</h2>
      <div className="mt-4 grid gap-3">
        {campaigns.length === 0 && <p className="text-sm text-slate-600">No campaigns created yet.</p>}
        {campaigns.map((campaign) => (
          <article key={campaign.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{campaign.name}</h3>
              <span className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white">{campaign.status}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700 sm:grid-cols-4">
              <div>Daily: {campaign.daily_budget.toFixed(2)} UZS</div>
              <div>Monthly: {campaign.monthly_budget.toFixed(2)} UZS</div>
              <div>Bid: {campaign.bid_default.toFixed(2)} UZS</div>
              <div>Cap: {campaign.bid_cap.toFixed(2)} UZS</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
