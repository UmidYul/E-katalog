"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CreditCard, FileCheck2, ReceiptText, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useB2BActs, useB2BInvoices, useB2BMe, useB2BPlans, usePayB2BInvoice, useSubscribeB2BPlan } from "@/features/b2b/use-b2b";
import { cn } from "@/lib/utils/cn";

const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

const formatMoney = (value: number, currency: string) => `${moneyFormatter.format(value)} ${currency}`;

export function B2BBillingPage() {
  const meQuery = useB2BMe();
  const primaryOrg = useMemo(() => meQuery.data?.organizations?.[0], [meQuery.data?.organizations]);
  const orgId = primaryOrg?.id;
  const currency = primaryOrg?.default_currency ?? "UZS";

  const plansQuery = useB2BPlans();
  const invoicesQuery = useB2BInvoices(orgId);
  const actsQuery = useB2BActs(orgId);
  const payMutation = usePayB2BInvoice(orgId);
  const subscribeMutation = useSubscribeB2BPlan(orgId);

  const [message, setMessage] = useState<string | null>(null);

  const loading = meQuery.isLoading || plansQuery.isLoading || invoicesQuery.isLoading || actsQuery.isLoading;
  if (loading) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading billing cockpit...</div>;
  }

  if (meQuery.isError || plansQuery.isError || invoicesQuery.isError || actsQuery.isError || !orgId || !meQuery.data) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load billing data.
      </div>
    );
  }

  const plans = plansQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const acts = actsQuery.data ?? [];
  const billingStatus = meQuery.data.billing_status_by_org[orgId] ?? "inactive";

  const outstandingAmount = invoices
    .filter((invoice) => invoice.status !== "paid" && invoice.status !== "void")
    .reduce((sum, invoice) => sum + Math.max(invoice.total_amount - invoice.paid_amount, 0), 0);
  const overdueCount = invoices.filter((invoice) => invoice.status === "overdue").length;
  const paidThisCycle = invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((sum, invoice) => sum + invoice.paid_amount, 0);

  const subscribePlan = (planCode: string) => {
    setMessage(null);
    subscribeMutation.mutate(planCode, {
      onSuccess: () => setMessage(`Plan ${planCode} subscription request accepted.`),
      onError: () => setMessage(`Failed to subscribe to ${planCode}.`),
    });
  };

  const payInvoice = (invoiceId: string, amountDue: number) => {
    setMessage(null);
    payMutation.mutate(
      {
        invoiceId,
        provider: "manual",
        amount: amountDue > 0 ? amountDue : undefined,
      },
      {
        onSuccess: () => setMessage(`Payment processed for invoice ${invoiceId.slice(0, 8)}.`),
        onError: () => setMessage(`Payment failed for invoice ${invoiceId.slice(0, 8)}.`),
      },
    );
  };

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-sky-300/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <WalletCards className="h-4 w-4 text-primary" />
              Billing status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{billingStatus}</p>
          </CardContent>
        </Card>
        <Card className={cn(overdueCount > 0 && "border-amber-300/70")}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Overdue invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{overdueCount}</p>
          </CardContent>
        </Card>
        <Card className={cn(outstandingAmount > 0 && "border-amber-300/70")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Outstanding balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatMoney(outstandingAmount, currency)}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-300/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Paid invoices total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatMoney(paidThisCycle, currency)}</p>
          </CardContent>
        </Card>
      </section>

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}

      <Card className="border-sky-300/60 bg-gradient-to-br from-sky-100/50 via-cyan-50/60 to-emerald-100/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            Plan catalog and subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.length ? (
            plans.map((plan) => (
              <article key={plan.id} className="rounded-xl border border-border/70 bg-white/80 p-4 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{plan.code}</p>
                <h3 className="mt-1 text-lg font-semibold">{plan.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  monthly {formatMoney(plan.monthly_fee, plan.currency)}
                </p>
                <p className="text-sm text-muted-foreground">
                  included clicks {plan.included_clicks.toLocaleString("ru-RU")}
                </p>
                <p className="text-sm text-muted-foreground">
                  overage {formatMoney(plan.click_price, plan.currency)} / click
                </p>
                <Button
                  className="mt-3"
                  variant="secondary"
                  onClick={() => subscribePlan(plan.code)}
                  disabled={subscribeMutation.isPending}
                >
                  {subscribeMutation.isPending ? "Submitting..." : "Subscribe"}
                </Button>
              </article>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No plans found.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-primary" />
              Invoices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {invoices.length ? (
              invoices.map((invoice) => {
                const dueAmount = Math.max(invoice.total_amount - invoice.paid_amount, 0);
                const canPay = invoice.status === "issued" || invoice.status === "overdue" || invoice.status === "partially_paid";
                return (
                  <article key={invoice.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{invoice.invoice_number}</p>
                        <p className="text-xs text-muted-foreground">{invoice.id}</p>
                      </div>
                      <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{invoice.status}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <p>total: {formatMoney(invoice.total_amount, invoice.currency)}</p>
                      <p>paid: {formatMoney(invoice.paid_amount, invoice.currency)}</p>
                      <p>due: {invoice.due_at ? new Date(invoice.due_at).toLocaleDateString("ru-RU") : "-"}</p>
                      <p>issued: {invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString("ru-RU") : "-"}</p>
                    </div>
                    {canPay ? (
                      <Button
                        className="mt-3"
                        size="sm"
                        onClick={() => payInvoice(invoice.id, dueAmount)}
                        disabled={payMutation.isPending}
                      >
                        {payMutation.isPending ? "Processing..." : `Pay ${formatMoney(dueAmount, invoice.currency)}`}
                      </Button>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-primary" />
              Closing acts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {acts.length ? (
              acts.map((act) => (
                <article key={act.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{act.act_number}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{act.status}</span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <p>Issued: {act.issued_at ? new Date(act.issued_at).toLocaleDateString("ru-RU") : "-"}</p>
                    <p>Signed: {act.signed_at ? new Date(act.signed_at).toLocaleDateString("ru-RU") : "-"}</p>
                  </div>
                  {act.document_url ? (
                    <a href={act.document_url} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">
                      Open document
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Acts are not generated yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
