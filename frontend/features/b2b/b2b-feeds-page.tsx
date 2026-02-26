"use client";

import { useMemo } from "react";

import { useB2BFeeds, useB2BMe } from "@/features/b2b/use-b2b";

export function B2BFeedsPage() {
  const meQuery = useB2BMe();
  const primaryOrgId = useMemo(() => meQuery.data?.organizations?.[0]?.id, [meQuery.data?.organizations]);
  const feedsQuery = useB2BFeeds(primaryOrgId);

  if (meQuery.isLoading || feedsQuery.isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading feeds...</div>;
  }

  if (meQuery.isError || feedsQuery.isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load feed manager data.
      </div>
    );
  }

  const feeds = feedsQuery.data ?? [];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Feed Manager</h2>
      <p className="mt-1 text-sm text-slate-600">Connected feeds for the selected organization.</p>
      <div className="mt-4 grid gap-3">
        {feeds.length === 0 && <p className="text-sm text-slate-600">No feeds connected yet.</p>}
        {feeds.map((feed) => (
          <article key={feed.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white">{feed.status}</span>
              <span className="rounded-md bg-white px-2 py-1 text-xs text-slate-700">{feed.source_type.toUpperCase()}</span>
              <span className="rounded-md bg-white px-2 py-1 text-xs text-slate-700">{feed.schedule_cron}</span>
            </div>
            <p className="mt-2 break-all text-sm text-slate-700">{feed.source_url}</p>
            <p className="mt-1 text-xs text-slate-500">
              last validated: {feed.last_validated_at ? new Date(feed.last_validated_at).toLocaleString() : "not validated"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
