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

const STATUS_LABELS: Record<string, string> = {
  all: "Все",
  draft: "Черновик",
  submitted: "Новая",
  review: "На проверке",
  approved: "Одобрено",
  rejected: "Отклонено",
  open: "Открыт",
  accepted: "Принят",
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  critical: "Критический",
  pending: "Ожидание",
  ready: "Готово",
  failed: "Ошибка",
};

const JOB_LABELS: Record<string, string> = {
  invoices: "Счета",
  acts: "Акты",
  "fraud-scan": "Антифрод",
  "feed-health": "Проверка фидов",
};

const localize = (value: string) => STATUS_LABELS[value] ?? value;

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
  const [maxFeeds, setMaxFeeds] = useState("10");
  const [maxCampaigns, setMaxCampaigns] = useState("5");

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
          <p className="text-sm text-muted-foreground">Доступ только для администраторов. Текущая роль: {role}.</p>
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
        rejection_reason: status === "rejected" ? rejectionReason.trim() || "Отклонено по результатам проверки" : undefined,
      },
      {
        onSuccess: () => setMessage(`Заявка ${applicationId.slice(0, 8)} переведена в статус «${localize(status)}».`),
        onError: () => setMessage(`Не удалось обновить заявку ${applicationId.slice(0, 8)}.`),
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
        onSuccess: (result) =>
          setMessage(
            `Лид ${leadId.slice(0, 8)} переведен в статус «${localize(status)}».` +
              (result?.provisioning_status ? ` Подготовка аккаунта: ${localize(result.provisioning_status)}.` : ""),
          ),
        onError: () => setMessage(`Не удалось обновить лид ${leadId.slice(0, 8)}.`),
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
        onSuccess: () => setMessage(`Спор ${disputeId.slice(0, 8)} переведен в статус «${localize(status)}».`),
        onError: () => setMessage(`Не удалось обновить спор ${disputeId.slice(0, 8)}.`),
      },
    );
  };

  const upsertPlan = () => {
    setMessage(null);
    if (!planCode.trim() || !planName.trim()) {
      setMessage("Укажите код и название тарифа.");
      return;
    }

    const parsedLimits: Record<string, unknown> = {
      max_feeds: Math.max(0, Number(maxFeeds) || 0),
      max_campaigns: Math.max(0, Number(maxCampaigns) || 0),
    };

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
          setMessage(`Тариф ${planCode} сохранен.`);
          setPlanCode("");
          setPlanName("");
        },
        onError: () => setMessage("Не удалось сохранить тариф."),
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
    <div className="space-y-6">
      <Card className="border-primary/25 bg-gradient-to-r from-primary/10 via-background to-accent/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">B2B Control</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Центр управления партнерскими заявками, онбордингом продавцов, спорами, рисками и тарифами.
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="border-sky-300/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileBadge2 className="h-4 w-4 text-primary" />
              Очередь онбординга
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
              Партнерские лиды
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
              Активные споры
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
              Критические риски
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
              Средний тариф
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatMoney(averagePlanFee, "UZS")}</p>
          </CardContent>
        </Card>
      </section>

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}

      <div className="grid grid-cols-1 gap-6">
        <Card className="w-full">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Заявки онбординга</CardTitle>
            <div className="w-44">
              <Select value={onboardingStatus} onValueChange={setOnboardingStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="draft">Черновик</SelectItem>
                  <SelectItem value="submitted">Новая</SelectItem>
                  <SelectItem value="review">На проверке</SelectItem>
                  <SelectItem value="approved">Одобрено</SelectItem>
                  <SelectItem value="rejected">Отклонено</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder="Причина отклонения (для статуса «Отклонено»)"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
            />
            {onboardingQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            {onboardingItems.length ? (
              onboardingItems.map((item) => (
                <article key={item.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{item.company_name}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{localize(item.status)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Орг.: {item.org_id}</p>
                  <p className="text-xs text-muted-foreground">Платежный email: {item.billing_email}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => patchOnboarding(item.id, "review")} disabled={patchOnboardingMutation.isPending}>
                      На проверку
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => patchOnboarding(item.id, "approved")} disabled={patchOnboardingMutation.isPending}>
                      Одобрить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => patchOnboarding(item.id, "rejected")} disabled={patchOnboardingMutation.isPending}>
                      Отклонить
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Заявок нет.</p>
            )}
          </CardContent>
        </Card>

        <Card className="w-full">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Партнерские лиды</CardTitle>
            <div className="w-44">
              <Select value={leadStatus} onValueChange={setLeadStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="submitted">Новые</SelectItem>
                  <SelectItem value="review">На проверке</SelectItem>
                  <SelectItem value="approved">Одобрено</SelectItem>
                  <SelectItem value="rejected">Отклонено</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Поиск по компании / email / контакту" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} />
            <Textarea rows={2} placeholder="Комментарий для одобрения/отклонения" value={leadReviewNote} onChange={(event) => setLeadReviewNote(event.target.value)} />
            {leadsQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            {leads.length ? (
              leads.map((lead) => (
                <article key={lead.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{lead.company_name}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{localize(lead.status)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{lead.contact_name}</p>
                  <p className="text-xs text-muted-foreground">{lead.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {lead.country_code} {lead.city ? `/ ${lead.city}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">Провижининг: {localize(lead.provisioning_status ?? "pending")}</p>
                  {lead.provisioned_org_id ? <p className="text-xs text-muted-foreground">Орг.: {lead.provisioned_org_id}</p> : null}
                  {lead.provisioned_user_id ? <p className="text-xs text-muted-foreground">Пользователь: {lead.provisioned_user_id}</p> : null}
                  {lead.welcome_email_sent_at ? <p className="text-xs text-muted-foreground">Приветственное письмо отправлено</p> : null}
                  {lead.provisioning_error ? <p className="text-xs text-rose-700">Ошибка провижининга: {lead.provisioning_error}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">Категории: {lead.categories?.length ? lead.categories.join(", ") : "не указаны"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => patchLead(lead.id, "review")} disabled={patchLeadMutation.isPending}>
                      На проверку
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => patchLead(lead.id, "approved")} disabled={patchLeadMutation.isPending}>
                      Одобрить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => patchLead(lead.id, "rejected")} disabled={patchLeadMutation.isPending}>
                      Отклонить
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Лиды не найдены.</p>
            )}
          </CardContent>
        </Card>

        <Card className="w-full">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Споры по списаниям</CardTitle>
            <div className="w-44">
              <Select value={disputeStatus} onValueChange={setDisputeStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="open">Открытые</SelectItem>
                  <SelectItem value="review">На проверке</SelectItem>
                  <SelectItem value="accepted">Принятые</SelectItem>
                  <SelectItem value="rejected">Отклоненные</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea rows={3} placeholder="Комментарий к решению по спору" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} />
            {disputesQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            {disputes.length ? (
              disputes.map((dispute) => (
                <article key={dispute.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{dispute.reason || "Спор"}</p>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{localize(dispute.status)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Списание: {dispute.click_charge_id}</p>
                  <p className="text-xs text-muted-foreground">{dispute.message || "Комментарий продавца отсутствует"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => patchDispute(dispute.id, "review")} disabled={patchDisputeMutation.isPending}>
                      На проверку
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => patchDispute(dispute.id, "accepted")} disabled={patchDisputeMutation.isPending}>
                      Принять
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => patchDispute(dispute.id, "rejected")} disabled={patchDisputeMutation.isPending}>
                      Отклонить
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Споры не найдены.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Flag className="h-4 w-4 text-primary" />
              Риск-флаги
            </CardTitle>
            <div className="w-40">
              <Select value={riskLevel} onValueChange={setRiskLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="low">Низкий</SelectItem>
                  <SelectItem value="medium">Средний</SelectItem>
                  <SelectItem value="high">Высокий</SelectItem>
                  <SelectItem value="critical">Критический</SelectItem>
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
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px]">{localize(flag.level)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Орг.: {flag.org_id ?? "неизвестно"}</p>
                  <p className="text-xs text-muted-foreground">Событие: {flag.click_event_id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Детали: {JSON.stringify(flag.details)}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Риск-флаги не найдены.</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-primary" />
                Тарифы B2B
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {plans.map((plan) => (
                <div key={plan.id} className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs">
                  <p className="font-semibold">
                    {plan.code} - {plan.name}
                  </p>
                  <p className="text-muted-foreground">
                    {formatMoney(plan.monthly_fee, plan.currency)} / {plan.included_clicks.toLocaleString("ru-RU")} кликов / {formatMoney(plan.click_price, plan.currency)} за клик
                  </p>
                </div>
              ))}

              <div className="space-y-3 rounded-xl border border-border/70 bg-background/60 p-3">
                <p className="text-xs font-semibold text-foreground">Создание или обновление тарифа</p>
                <p className="text-xs text-muted-foreground">Заполните поля ниже. Ограничения указываются обычными числами, без JSON.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Код тарифа (например: pro_plus)" value={planCode} onChange={(event) => setPlanCode(event.target.value)} />
                  <Input placeholder="Название тарифа" value={planName} onChange={(event) => setPlanName(event.target.value)} />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input type="number" placeholder="Абонплата в месяц" value={monthlyFee} onChange={(event) => setMonthlyFee(event.target.value)} />
                  <Input type="number" placeholder="Клики включены в тариф" value={includedClicks} onChange={(event) => setIncludedClicks(event.target.value)} />
                  <Input type="number" placeholder="Цена клика сверх лимита" value={clickPrice} onChange={(event) => setClickPrice(event.target.value)} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input type="number" placeholder="Лимит фидов" value={maxFeeds} onChange={(event) => setMaxFeeds(event.target.value)} />
                  <Input type="number" placeholder="Лимит кампаний" value={maxCampaigns} onChange={(event) => setMaxCampaigns(event.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">Если указать 0, ограничение считается отключенным.</p>
                <Button onClick={upsertPlan} disabled={upsertPlanMutation.isPending}>
                  {upsertPlanMutation.isPending ? "Сохранение..." : "Сохранить тариф"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-4 w-4 text-primary" />
                Фоновые задачи B2B
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="secondary" onClick={() => runJob("invoices")} disabled={runJobMutation.isPending}>
                  Запустить счета
                </Button>
                <Button variant="secondary" onClick={() => runJob("acts")} disabled={runJobMutation.isPending}>
                  Запустить акты
                </Button>
                <Button variant="outline" onClick={() => runJob("fraud-scan")} disabled={runJobMutation.isPending}>
                  Запустить антифрод
                </Button>
                <Button variant="outline" onClick={() => runJob("feed-health")} disabled={runJobMutation.isPending}>
                  Проверить фиды
                </Button>
              </div>

              {runJobMutation.isPending ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Ставим задачу в очередь...
                </p>
              ) : null}

              {jobLogs.length ? (
                <div className="space-y-2">
                  {jobLogs.map((log) => (
                    <div key={log.id} className="rounded-xl border border-border/70 bg-background/60 p-2 text-xs">
                      <p className="font-semibold">{JOB_LABELS[log.job] ?? log.job}</p>
                      <p className="text-muted-foreground">{log.id}</p>
                      <p className="text-muted-foreground">{new Date(log.ts).toLocaleString("ru-RU")}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">В этой сессии задачи еще не запускались.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          Все действия логируются в аудит. Указывайте причины отклонения и комментарии к решениям.
        </CardContent>
      </Card>
    </div>
  );
}
