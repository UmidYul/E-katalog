"use client";

import { useMemo } from "react";

import { useB2BMe } from "@/features/b2b/use-b2b";

export function B2BOnboardingPage() {
  const meQuery = useB2BMe();
  const organizations = useMemo(() => meQuery.data?.organizations ?? [], [meQuery.data?.organizations]);

  if (meQuery.isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading onboarding state...</div>;
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load onboarding data.
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Onboarding & KYC</h2>
      <p className="mt-1 text-sm text-slate-600">
        Status tracking is live. Use API endpoints `/b2b/onboarding/*` for form submission, documents and contract acceptance.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-4">Organization</th>
              <th className="py-2 pr-4">Onboarding</th>
              <th className="py-2 pr-4">Billing</th>
              <th className="py-2 pr-4">Role</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((org) => {
              const membership = meQuery.data.memberships.find((m) => m.org_id === org.id);
              return (
                <tr key={org.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 text-slate-900">{org.name}</td>
                  <td className="py-2 pr-4 text-slate-700">{meQuery.data.onboarding_status_by_org[org.id] ?? "draft"}</td>
                  <td className="py-2 pr-4 text-slate-700">{meQuery.data.billing_status_by_org[org.id] ?? "inactive"}</td>
                  <td className="py-2 pr-4 text-slate-700">{membership?.role ?? "unknown"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
