"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Building2,
  FileBadge2,
  Flag,
  Loader2,
  PackageCheck,
  Play,
  Scale,
  ShieldAlert,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useAdminB2BDisputes,
  useAdminB2BOnboardingApplications,
  useAdminB2BPartnerLeads,
  useAdminB2BPlans,
  useAdminB2BRiskFlags,
  usePatchAdminB2BDispute,
  usePatchAdminB2BOnboardingApplication,
  usePatchAdminB2BPartnerLead,
  useRunAdminB2BJob,
  useUpsertAdminB2BPlan,
} from "@/features/b2b/use-admin-b2b";
import { useAdminAccess } from "@/features/auth/use-admin-access";

const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

const formatMoney = (value: number, currency: string) => `${moneyFormatter.format(value)} ${currency}`;

export default function AdminB2BPage() {
  const { role } = useAdminAccess();
  const isAdmin = role === "admin";

  const [onboardingStatus, setOnboardingStatus] = useState("submitted");
  const [leadStatus, setLeadStatus] = useState("submitted");
  const [leadSearch, setLeadSearch] = useState("");
  const [disputeStatus, setDisputeStatus] = useState("open");
  const [riskLevel, setRiskLevel] = useState("all");
  const [rejectionReason, setRejectionReason] = useState("");
  const [leadReviewNote, setLeadReviewNote] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const [planCode, setPlanCode] = useState("");
  const [planName, setPlanName] = useState("");
  const [monthlyFee, setMonthlyFee] = useState("0");
  const [includedClicks, setIncludedClicks] = useState("0");
  const [clickPrice, setClickPrice] = useState("0");
  const [limitsJson, setLimitsJson] = useState('{"max_feeds":10,"max_campaigns":5}');

  const [jobLogs, setJobLogs] = useState<Array<{ id: string; job: string; queued: string; ts: string }>>([]);

  const onboardingQuery = useAdminB2BOnboardingApplications({
    status: onboardingStatus === "all" ? undefined : onboardingStatus,
    limit: 20,
    offset: 0,
  });
  const leadsQuery = useAdminB2BPartnerLeads({
    status: leadStatus === "all" ? undefined : leadStatus,
    q: leadSearch.trim() || undefined,
    limit: 20,
    offset: 0,
  });
  const disputesQuery = useAdminB2BDisputes({
    status: disputeStatus === "all" ? undefined : disputeStatus,
    limit: 20,
    offset: 0,
  });
  const riskFlagsQuery = useAdminB2BRiskFlags({
    level: riskLevel === "all" ? undefined : riskLevel,
    limit: 30,
    offset: 0,
  });
  const plansQuery = useAdminB2BPlans();

  const patchOnboardingMutation = usePatchAdminB2BOnboardingApplication();
  const patchLeadMutation = usePatchAdminB2BPartnerLead();
  const patchDisputeMutation = usePatchAdminB2BDispute();
  const upsertPlanMutation = useUpsertAdminB2BPlan();
  const runJobMutation = useRunAdminB2BJob();

  const onboardingItems = onboardingQuery.data?.items ?? [];
  const leads = leadsQuery.data?.items ?? [];
  const disputes = disputesQuery.data?.items ?? [];
  const riskFlags = riskFlagsQuery.data?.items ?? [];
  const plans = plansQuery.data ?? [];

  const openOnboardingCount = onboardingItems.filter((item) => item.status === "submitted" || item.status === "review").length;
  const openLeadsCount = leads.filter((item) => item.status === "submitted" || item.status === "review").length;
  const openDisputesCount = disputes.filter((item) => item.status === "open" || item.status === "review").length;
  const criticalRiskCount = riskFlags.filter((item) => item.level === "critical").length;
  const averagePlanFee = plans.length ? plans.reduce((sum, plan) => sum + plan.monthly_fee, 0) / plans.length : 0;

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">Only admins can access B2B control center. Current role: {role}.</p>
        </CardContent>
      </Card>
    );
  }

  const patchOnboarding = (applicationId: string, status: string) => {
    setMessage(null);
    patchOnboardingMutation.mutate(
      {
        applicationId,
        status,
        rejection_reason: status === "rejected" ? rejectionReason.trim() || "Rejected by admin review" : undefined,
      },
      {
        onSuccess: () => setMessage(`Application ${applicationId.slice(0, 8)} moved to ${status}.`),
        onError: () => setMessage(`Failed to update application ${applicationId.slice(0, 8)}.`),
      },
    );
  };

  const patchLead = (leadId: string, status: string) => {
    setMessage(null);
    patchLeadMutation.mutate(
      {
        leadId,
        status,
        review_note: leadReviewNote.trim() || undefined,
      },
      {
        onSuccess: () => setMessage(`Lead ${leadId.slice(0, 8)} moved to ${status}.`),
        onError: () => setMessage(`Failed to update lead ${leadId.slice(0, 8)}.`),
      },
    );
  };

  const patchDispute = (disputeId: string, status: string) => {
    setMessage(null);
    patchDisputeMutation.mutate(
      {
        disputeId,
        status,
        resolution_note: resolutionNote.trim() || undefined,
      },
      {
        onSuccess: () => setMessage(`Dispute ${disputeId.slice(0, 8)} moved to ${status}.`),
        onError: () => setMessage(`Failed to update dispute ${disputeId.slice(0, 8)}.`),
      },
    );
  };

  const upsertPlan = () => {
    setMessage(null);
    if (!planCode.trim() || !planName.trim()) {
      setMessage("Plan code and name are required.");
      return;
    }

    let parsedLimits: Record<string, unknown>;
    try {
      parsedLimits = limitsJson.trim() ? (JSON.parse(limitsJson) as Record<string, unknown>) : {};
    } catch {
      setMessage("Limits JSON is invalid.");
      return;
    }

    upsertPlanMutation.mutate(
      {
        code: planCode.trim(),
        name: planName.trim(),
        monthly_fee: Number(monthlyFee) || 0,
        included_clicks: Math.max(0, Number(includedClicks) || 0),
        click_price: Number(clickPrice) || 0,
        limits: parsedLimits,
      },
      {
        onSuccess: () => {
          setMessage(`Plan ${planCode} saved.`);
          setPlanCode("");
          setPlanName("");
        },
        onError: () => setMessage("Failed to save plan."),
      },
    );
  };

  const runJob = (job: "invoices" | "acts" | "fraud-scan" | "feed-health") => {
    runJobMutation.mutate(job, {
      onSuccess: (result) => {
        setJobLogs((current) => [{ id: result.task_id, job, queued: result.queued, ts: new Date().toISOString() }, ...current].slice(0, 10));
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="border-sky-300/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileBadge2 className="h-4 w-4 text-primary" />
              Onboarding queue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{openOnboardingCount}</p>
          </CardContent>
        </Card>
        <Card className="border-indigo-300/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-indigo-600" />
              Partner leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{openLeadsCount}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-300/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Scale className="h-4 w-4 text-amber-600" />
              Active disputes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{openDisputesCount}</p>
          </CardContent>
        </Card>
        <Card className={criticalRiskCount > 0 ? "border-rose-300/80" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="h-4 w-4 text-rose-600" />
              Critical risk flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{criticalRiskCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <WalletCards className="h-4 w-4 text-primary" />
              Avg plan fee
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatMoney(averagePlanFee, "UZS")}</p>
          </CardContent>
        </Card>
      </section>

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Onboarding applications</CardTitle>
            <div className="w-44">
              <Select value={onboardingStatus} onValueChange={setOnboardingStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="draft">draft</SelectItem>
                  <SelectItem value="submitted">submitted</SelectItem>
                  <SelectItem value="review">review</SelectItem>
                  <SelectItem value="approved">approved</SelectItem>
                  <SelectItem value="rejected">rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Rejection reason (used for rejected status)" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} />
            {onboardingQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            {onboardingItems.length ? (
              onboardingItems.map((item) => (
                <article key={item.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{item.company_name}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{item.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">org: {item.org_id}</p>
                  <p className="text-xs text-muted-foreground">billing: {item.billing_email}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => patchOnboarding(item.id, "review")} disabled={patchOnboardingMutation.isPending}>
                      Review
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => patchOnboarding(item.id, "approved")} disabled={patchOnboardingMutation.isPending}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => patchOnboarding(item.id, "rejected")} disabled={patchOnboardingMutation.isPending}>
                      Reject
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No applications found.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Partner leads</CardTitle>
            <div className="w-44">
              <Select value={leadStatus} onValueChange={setLeadStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="submitted">submitted</SelectItem>
                  <SelectItem value="review">review</SelectItem>
                  <SelectItem value="approved">approved</SelectItem>
                  <SelectItem value="rejected">rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Search company/email/contact" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} />
            <Textarea
              rows={2}
              placeholder="Review note for approve/reject"
              value={leadReviewNote}
              onChange={(event) => setLeadReviewNote(event.target.value)}
            />
            {leadsQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            {leads.length ? (
              leads.map((lead) => (
                <article key={lead.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{lead.company_name}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{lead.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{lead.contact_name}</p>
                  <p className="text-xs text-muted-foreground">{lead.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {lead.country_code} {lead.city ? `/ ${lead.city}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    categories: {lead.categories?.length ? lead.categories.join(", ") : "n/a"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => patchLead(lead.id, "review")} disabled={patchLeadMutation.isPending}>
                      Review
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => patchLead(lead.id, "approved")} disabled={patchLeadMutation.isPending}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => patchLead(lead.id, "rejected")} disabled={patchLeadMutation.isPending}>
                      Reject
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No partner leads found.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Dispute resolution</CardTitle>
            <div className="w-44">
              <Select value={disputeStatus} onValueChange={setDisputeStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="open">open</SelectItem>
                  <SelectItem value="review">review</SelectItem>
                  <SelectItem value="accepted">accepted</SelectItem>
                  <SelectItem value="rejected">rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              rows={3}
              placeholder="Resolution note for accepted/rejected actions"
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
            />
            {disputesQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            {disputes.length ? (
              disputes.map((dispute) => (
                <article key={dispute.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{dispute.reason || "Dispute"}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{dispute.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">charge: {dispute.click_charge_id}</p>
                  <p className="text-xs text-muted-foreground">{dispute.message || "No merchant message"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => patchDispute(dispute.id, "review")} disabled={patchDisputeMutation.isPending}>
                      Review
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => patchDispute(dispute.id, "accepted")} disabled={patchDisputeMutation.isPending}>
                      Accept
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => patchDispute(dispute.id, "rejected")} disabled={patchDisputeMutation.isPending}>
                      Reject
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No disputes found.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Flag className="h-4 w-4 text-primary" />
              Risk flags
            </CardTitle>
            <div className="w-40">
              <Select value={riskLevel} onValueChange={setRiskLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="critical">critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {riskFlagsQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            {riskFlags.length ? (
              riskFlags.map((flag) => (
                <article key={flag.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{flag.code}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{flag.level}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">org: {flag.org_id ?? "unknown"}</p>
                  <p className="text-xs text-muted-foreground">event: {flag.click_event_id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">details: {JSON.stringify(flag.details)}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No risk flags found.</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-primary" />
                Billing plans
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {plans.map((plan) => (
                <div key={plan.id} className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs">
                  <p className="font-semibold">
                    {plan.code} - {plan.name}
                  </p>
                  <p className="text-muted-foreground">
                    {formatMoney(plan.monthly_fee, plan.currency)} / {plan.included_clicks.toLocaleString("ru-RU")} clicks / {formatMoney(plan.click_price, plan.currency)} click
                  </p>
                </div>
              ))}

              <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
                <Input placeholder="Code" value={planCode} onChange={(event) => setPlanCode(event.target.value)} />
                <Input placeholder="Name" value={planName} onChange={(event) => setPlanName(event.target.value)} />
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input type="number" placeholder="Monthly fee" value={monthlyFee} onChange={(event) => setMonthlyFee(event.target.value)} />
                  <Input type="number" placeholder="Included clicks" value={includedClicks} onChange={(event) => setIncludedClicks(event.target.value)} />
                  <Input type="number" placeholder="Click price" value={clickPrice} onChange={(event) => setClickPrice(event.target.value)} />
                </div>
                <Textarea rows={3} placeholder='{"max_feeds":10}' value={limitsJson} onChange={(event) => setLimitsJson(event.target.value)} />
                <Button onClick={upsertPlan} disabled={upsertPlanMutation.isPending}>
                  {upsertPlanMutation.isPending ? "Saving..." : "Upsert plan"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-4 w-4 text-primary" />
                B2B automation jobs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="secondary" onClick={() => runJob("invoices")} disabled={runJobMutation.isPending}>
                  Run invoices
                </Button>
                <Button variant="secondary" onClick={() => runJob("acts")} disabled={runJobMutation.isPending}>
                  Run acts
                </Button>
                <Button variant="outline" onClick={() => runJob("fraud-scan")} disabled={runJobMutation.isPending}>
                  Run fraud scan
                </Button>
                <Button variant="outline" onClick={() => runJob("feed-health")} disabled={runJobMutation.isPending}>
                  Run feed health
                </Button>
              </div>

              {runJobMutation.isPending ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Queueing task...
                </p>
              ) : null}

              {jobLogs.length ? (
                <div className="space-y-2">
                  {jobLogs.map((log) => (
                    <div key={log.id} className="rounded-xl border border-border/70 bg-background/60 p-2 text-xs">
                      <p className="font-semibold">{log.job}</p>
                      <p className="text-muted-foreground">{log.id}</p>
                      <p className="text-muted-foreground">{new Date(log.ts).toLocaleString("ru-RU")}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No jobs triggered in this session.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          All actions are auditable and hit admin B2B endpoints directly. Keep rejection/resolution notes explicit for compliance.
        </CardContent>
      </Card>
    </div>
  );
}
