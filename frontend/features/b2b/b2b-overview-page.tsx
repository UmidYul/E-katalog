"use client";

import { useMemo } from "react";

import { useB2BAnalyticsOverview, useB2BMe } from "@/features/b2b/use-b2b";

export function B2BOverviewPage() {
  const meQuery = useB2BMe();
  const primaryOrgId = useMemo(() => meQuery.data?.organizations?.[0]?.id, [meQuery.data?.organizations]);
  const analyticsQuery = useB2BAnalyticsOverview(primaryOrgId, 30);

  if (meQuery.isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading B2B profile...</div>;
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load B2B profile.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
        <h2 className="text-lg font-semibold text-slate-900">Organizations</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {meQuery.data.organizations.map((org) => (
            <article key={org.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">{org.name}</div>
              <div className="mt-1 text-xs text-slate-600">{org.slug}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md bg-slate-900 px-2 py-1 text-white">{org.status}</span>
                <span className="rounded-md bg-white px-2 py-1 text-slate-700">
                  onboarding: {meQuery.data.onboarding_status_by_org[org.id] ?? "draft"}
                </span>
                <span className="rounded-md bg-white px-2 py-1 text-slate-700">
                  billing: {meQuery.data.billing_status_by_org[org.id] ?? "inactive"}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">30-day Performance</h2>
        {analyticsQuery.isLoading && <p className="mt-4 text-sm text-slate-600">Loading analytics...</p>}
        {analyticsQuery.data && (
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Total clicks</span>
              <span className="font-semibold text-slate-900">{Number(analyticsQuery.data.summary.total_clicks ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Billable clicks</span>
              <span className="font-semibold text-slate-900">{Number(analyticsQuery.data.summary.billable_clicks ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Spend</span>
              <span className="font-semibold text-slate-900">{Number(analyticsQuery.data.summary.spend ?? 0).toFixed(2)} UZS</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Avg CPC</span>
              <span className="font-semibold text-slate-900">{Number(analyticsQuery.data.summary.avg_cpc ?? 0).toFixed(2)} UZS</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
