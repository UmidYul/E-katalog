"use client";

import { useMemo } from "react";

import { useB2BActs, useB2BInvoices, useB2BMe, useB2BPlans, usePayB2BInvoice } from "@/features/b2b/use-b2b";

export function B2BBillingPage() {
  const meQuery = useB2BMe();
  const primaryOrgId = useMemo(() => meQuery.data?.organizations?.[0]?.id, [meQuery.data?.organizations]);
  const plansQuery = useB2BPlans();
  const invoicesQuery = useB2BInvoices(primaryOrgId);
  const actsQuery = useB2BActs(primaryOrgId);
  const payMutation = usePayB2BInvoice(primaryOrgId);

  const loading = meQuery.isLoading || plansQuery.isLoading || invoicesQuery.isLoading || actsQuery.isLoading;
  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading billing...</div>;
  }

  if (meQuery.isError || plansQuery.isError || invoicesQuery.isError || actsQuery.isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load billing data.
      </div>
    );
  }

  const plans = plansQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const acts = actsQuery.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Plan Catalog</h2>
        <div className="mt-4 space-y-2">
          {plans.map((plan) => (
            <article key={plan.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="font-medium text-slate-900">{plan.name}</div>
              <div className="text-slate-700">
                {plan.monthly_fee.toFixed(2)} {plan.currency}/month, {plan.click_price.toFixed(2)} per click
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Invoices</h2>
        <div className="mt-4 space-y-2">
          {invoices.length === 0 && <p className="text-sm text-slate-600">No invoices yet.</p>}
          {invoices.map((invoice) => (
            <article key={invoice.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{invoice.invoice_number}</span>
                <span className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white">{invoice.status}</span>
              </div>
              <div className="mt-1 text-slate-700">
                {invoice.total_amount.toFixed(2)} / paid {invoice.paid_amount.toFixed(2)} {invoice.currency}
              </div>
              {(invoice.status === "issued" || invoice.status === "overdue" || invoice.status === "partially_paid") && (
                <button
                  type="button"
                  onClick={() => payMutation.mutate({ invoiceId: invoice.id })}
                  disabled={payMutation.isPending}
                  className="mt-2 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {payMutation.isPending ? "Processing..." : "Pay now"}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
        <h2 className="text-lg font-semibold text-slate-900">Acts</h2>
        <div className="mt-4 space-y-2 text-sm">
          {acts.length === 0 && <p className="text-slate-600">No closing acts generated yet.</p>}
          {acts.map((act) => (
            <article key={act.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{act.act_number}</span>
                <span className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white">{act.status}</span>
              </div>
              {act.document_url && (
                <a href={act.document_url} className="mt-1 inline-block text-xs text-sky-700 hover:underline">
                  Open document
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
