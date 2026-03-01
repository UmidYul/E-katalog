"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  CircleDotDashed,
  CreditCard,
  Filter,
  Megaphone,
  MessageSquareWarning,
  PackageCheck,
  Wallet,
} from "lucide-react";

import { AreaTimeseriesChart } from "@/components/charts/area-timeseries-chart";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useB2BAnalyticsAttribution,
  useB2BAnalyticsOffers,
  useB2BAnalyticsOverview,
  useB2BCampaigns,
  useB2BFeeds,
  useB2BInvoices,
  useB2BMe,
  useB2BTickets,
  useCreateB2BTicket,
} from "@/features/b2b/use-b2b";
import { useSellerProducts, useSellerShop, useUpdateSellerShop } from "@/features/seller/use-seller";
import { cn } from "@/lib/utils/cn";

const PERIODS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
] as const;

const numberFormatter = new Intl.NumberFormat("ru-RU");
const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const formatMoney = (value: number, currency: string) => `${moneyFormatter.format(value)} ${currency}`;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9()\s-]{7,20}$/;
const URL_REGEX = /^https?:\/\/\S+$/i;
const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/;

const formatDateLabel = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
};

function SummaryMetric({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "warn" | "good" }) {
  return (
    <Card
      className={cn(
        "border-border/80 bg-card/90",
        tone === "warn" && "border-amber-300/60",
        tone === "good" && "border-emerald-300/70",
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function B2BDashboardPage() {
  const [periodDays, setPeriodDays] = useState<(typeof PERIODS)[number]["value"]>(30);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketCategory, setTicketCategory] = useState("technical");
  const [ticketPriority, setTicketPriority] = useState("normal");
  const [ticketBody, setTicketBody] = useState("");
  const [ticketMessage, setTicketMessage] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileWebsite, setProfileWebsite] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileLogoUrl, setProfileLogoUrl] = useState("");
  const [profileBannerUrl, setProfileBannerUrl] = useState("");
  const [profileBrandColor, setProfileBrandColor] = useState("");
  const [profileMessage, setProfileMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const meQuery = useB2BMe();
  const sellerShopQuery = useSellerShop();
  const sellerProductsQuery = useSellerProducts({ limit: 1, offset: 0 });
  const updateSellerShopMutation = useUpdateSellerShop();
  const primaryOrg = useMemo(() => meQuery.data?.organizations?.[0], [meQuery.data?.organizations]);
  const orgId = primaryOrg?.id;
  const currency = primaryOrg?.default_currency ?? "UZS";

  const analyticsQuery = useB2BAnalyticsOverview(orgId, periodDays);
  const offersQuery = useB2BAnalyticsOffers(orgId, 10);
  const attributionQuery = useB2BAnalyticsAttribution(orgId, periodDays);
  const campaignsQuery = useB2BCampaigns(orgId);
  const feedsQuery = useB2BFeeds(orgId);
  const invoicesQuery = useB2BInvoices(orgId);
  const ticketsQuery = useB2BTickets(orgId);
  const createTicketMutation = useCreateB2BTicket(orgId);

  useEffect(() => {
    if (!sellerShopQuery.data) return;
    setProfileName(String(sellerShopQuery.data.shop_name ?? ""));
    setProfileWebsite(String(sellerShopQuery.data.website_url ?? ""));
    setProfileEmail(String(sellerShopQuery.data.contact_email ?? ""));
    setProfilePhone(String(sellerShopQuery.data.contact_phone ?? ""));
    const metadata = sellerShopQuery.data.metadata ?? {};
    setProfileLogoUrl(typeof metadata.logo_url === "string" ? metadata.logo_url : "");
    setProfileBannerUrl(typeof metadata.banner_url === "string" ? metadata.banner_url : "");
    setProfileBrandColor(typeof metadata.brand_color === "string" ? metadata.brand_color : "");
  }, [sellerShopQuery.data]);

  if (meQuery.isLoading) {
    return <div className="rounded-3xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading seller control center...</div>;
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="rounded-3xl border border-rose-300 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load seller profile. Please refresh and try again.
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="space-y-4 rounded-3xl border border-border bg-card p-6">
        <h2 className="text-xl font-semibold">Seller account is not initialized</h2>
        <p className="text-sm text-muted-foreground">
          Create your first organization and pass onboarding to unlock feed management, campaigns, billing, and analytics.
        </p>
        <Link href="/dashboard/seller/onboarding" className={buttonVariants()}>
          Start onboarding
        </Link>
      </div>
    );
  }

  const summary = analyticsQuery.data?.summary ?? {};
  const totalClicks = toNumber(summary.total_clicks);
  const billableClicks = toNumber(summary.billable_clicks);
  const spend = toNumber(summary.spend);
  const avgCpc = toNumber(summary.avg_cpc);
  const ctr = toNumber(summary.ctr);
  const uniqueSessions = toNumber(summary.unique_sessions);

  const chartSeries = (analyticsQuery.data?.series ?? []).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ts: formatDateLabel(item.ts),
      clicks: toNumber(item.clicks),
      spend: toNumber(item.spend),
      billable_clicks: toNumber(item.billable_clicks),
    };
  });

  const campaigns = campaignsQuery.data ?? [];
  const feeds = feedsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const tickets = ticketsQuery.data ?? [];
  const topOffers = offersQuery.data ?? [];
  const attributionRows = attributionQuery.data ?? [];

  const activeCampaigns = campaigns.filter((item) => item.status === "active").length;
  const activeFeeds = feeds.filter((item) => item.is_active).length;
  const overdueInvoices = invoices.filter((item) => item.status === "overdue").length;
  const openTickets = tickets.filter((item) => item.status === "open" || item.status === "in_progress").length;

  const outstandingAmount = invoices
    .filter((item) => item.status !== "paid" && item.status !== "void")
    .reduce((sum, item) => sum + Math.max(item.total_amount - item.paid_amount, 0), 0);

  const topOffersSpend = topOffers.reduce((sum, item) => sum + item.spend, 0);
  const lastSync = analyticsQuery.data?.generated_at ? new Date(analyticsQuery.data.generated_at).toLocaleString("ru-RU") : "-";
  const onboardingStatus = meQuery.data.onboarding_status_by_org[orgId] ?? "draft";
  const billingStatus = meQuery.data.billing_status_by_org[orgId] ?? "inactive";
  const hasAnyProducts = (sellerProductsQuery.data?.length ?? 0) > 0;
  const hasProfileName = profileName.trim().length >= 2;
  const hasProfileEmail = EMAIL_REGEX.test(profileEmail.trim().toLowerCase());
  const hasProfilePhone = PHONE_REGEX.test(profilePhone.trim());
  const hasWebsite = !profileWebsite.trim() || URL_REGEX.test(profileWebsite.trim());
  const hasLogoUrl = !profileLogoUrl.trim() || URL_REGEX.test(profileLogoUrl.trim());
  const hasBannerUrl = !profileBannerUrl.trim() || URL_REGEX.test(profileBannerUrl.trim());
  const hasBrandColor = !profileBrandColor.trim() || HEX_COLOR_REGEX.test(profileBrandColor.trim());
  const normalizedBrandColor = profileBrandColor.trim()
    ? profileBrandColor.trim().startsWith("#")
      ? profileBrandColor.trim().toLowerCase()
      : `#${profileBrandColor.trim().toLowerCase()}`
    : "#0f766e";
  const brandColorPreview = hasBrandColor ? normalizedBrandColor : "#0f766e";

  const onboardingTasks = [
    { label: "Set shop name", ok: hasProfileName, hint: hasProfileName ? "Done" : "Add a clear storefront name", href: "#company-profile", cta: "Fix" },
    { label: "Set work email", ok: hasProfileEmail, hint: hasProfileEmail ? "Done" : "A valid email is required", href: "#company-profile", cta: "Fix" },
    { label: "Set contact phone", ok: hasProfilePhone, hint: hasProfilePhone ? "Done" : "A reachable phone is required", href: "#company-profile", cta: "Fix" },
    { label: "Add website (optional)", ok: hasWebsite, hint: hasWebsite ? "Done" : "Use URL with http:// or https://", href: "#company-profile", cta: "Fix" },
    {
      label: "Configure branding",
      ok: hasLogoUrl && hasBannerUrl && hasBrandColor,
      hint: hasLogoUrl && hasBannerUrl && hasBrandColor ? "Done" : "Set logo, banner, and brand color",
      href: "#company-profile",
      cta: "Open",
    },
    { label: "Pass onboarding", ok: onboardingStatus === "approved", hint: onboardingStatus, href: "/dashboard/seller/onboarding", cta: "Open" },
    { label: "Upload first product", ok: hasAnyProducts, hint: hasAnyProducts ? "Done" : "Add at least one SKU", href: "/dashboard/seller/products/new", cta: "Add" },
    { label: "Activate at least one feed", ok: activeFeeds > 0, hint: `${activeFeeds} active`, href: "/dashboard/seller/feeds", cta: "Open" },
    { label: "Launch at least one campaign", ok: activeCampaigns > 0, hint: `${activeCampaigns} active`, href: "/dashboard/seller/campaigns", cta: "Launch" },
  ];
  const onboardingDone = onboardingTasks.filter((item) => item.ok).length;
  const onboardingProgress = Math.round((onboardingDone / onboardingTasks.length) * 100);

  const checklist = [
    { label: "Onboarding approved", ok: onboardingStatus === "approved", hint: onboardingStatus },
    { label: "At least one active feed", ok: activeFeeds > 0, hint: `${activeFeeds} active` },
    { label: "At least one active campaign", ok: activeCampaigns > 0, hint: `${activeCampaigns} active` },
    { label: "No overdue invoices", ok: overdueInvoices === 0, hint: `${overdueInvoices} overdue` },
  ];

  const saveCompanyProfile = async () => {
    setProfileMessage(null);
    if (!hasProfileName) {
      setProfileMessage({ kind: "error", text: "Store name must be at least 2 characters." });
      return;
    }
    if (!hasProfileEmail) {
      setProfileMessage({ kind: "error", text: "Enter a valid work email." });
      return;
    }
    if (!hasProfilePhone) {
      setProfileMessage({ kind: "error", text: "Enter a valid contact phone." });
      return;
    }
    if (!hasWebsite) {
      setProfileMessage({ kind: "error", text: "Website URL must start with http:// or https://." });
      return;
    }
    if (!hasLogoUrl) {
      setProfileMessage({ kind: "error", text: "Logo URL must start with http:// or https://." });
      return;
    }
    if (!hasBannerUrl) {
      setProfileMessage({ kind: "error", text: "Banner URL must start with http:// or https://." });
      return;
    }
    if (!hasBrandColor) {
      setProfileMessage({ kind: "error", text: "Brand color must be in hex format, for example #0f766e." });
      return;
    }
    try {
      await updateSellerShopMutation.mutateAsync({
        shop_name: profileName.trim(),
        website_url: profileWebsite.trim() || null,
        contact_email: profileEmail.trim().toLowerCase(),
        contact_phone: profilePhone.trim(),
        logo_url: profileLogoUrl.trim() || null,
        banner_url: profileBannerUrl.trim() || null,
        brand_color: profileBrandColor.trim() || null,
      });
      setProfileMessage({ kind: "success", text: "Company profile was saved." });
    } catch {
      setProfileMessage({ kind: "error", text: "Failed to save company profile. Please try again." });
    }
  };

  const createTicket = () => {
    setTicketMessage(null);
    if (!ticketSubject.trim() || !ticketBody.trim()) {
      setTicketMessage("Subject and description are required.");
      return;
    }
    createTicketMutation.mutate(
      {
        subject: ticketSubject.trim(),
        category: ticketCategory,
        priority: ticketPriority,
        body: ticketBody.trim(),
      },
      {
        onSuccess: () => {
          setTicketSubject("");
          setTicketBody("");
          setTicketMessage("Ticket was created and sent to support.");
        },
        onError: () => {
          setTicketMessage("Failed to create ticket. Try again.");
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-sky-200/70 bg-gradient-to-br from-sky-100 via-cyan-50 to-emerald-100 p-6 shadow-soft">
        <div className="absolute -right-20 -top-24 h-52 w-52 rounded-full bg-sky-300/35 blur-3xl" />
        <div className="absolute -left-16 bottom-0 h-44 w-44 rounded-full bg-emerald-300/30 blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-sky-300/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-900">
              <CircleDotDashed className="h-3.5 w-3.5" />
              Seller performance hub
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{primaryOrg.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-700">
              One cockpit for traffic quality, monetization health, feed reliability, and campaign pacing.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-slate-900 px-3 py-1 font-semibold text-white">org: {primaryOrg.status}</span>
              <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">onboarding: {onboardingStatus}</span>
              <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">billing: {billingStatus}</span>
              <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">tickets open: {openTickets}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-sky-200/70 bg-white/80 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">Analytics period</p>
              <p className="text-xs text-muted-foreground">Synced: {lastSync}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {PERIODS.map((period) => (
                <button
                  key={period.value}
                  type="button"
                  onClick={() => setPeriodDays(period.value)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                    periodDays === period.value ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-100",
                  )}
                >
                  {period.label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-2">
              <Link href="/dashboard/seller/campaigns" className={cn(buttonVariants(), "justify-between")}>
                Manage campaigns
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link href="/dashboard/seller/feeds" className={cn(buttonVariants({ variant: "secondary" }), "justify-between")}>
                Validate feeds
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link href="/dashboard/seller/billing" className={cn(buttonVariants({ variant: "outline" }), "justify-between")}>
                Review invoices
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric label="Total clicks" value={numberFormatter.format(totalClicks)} hint={`${numberFormatter.format(uniqueSessions)} unique sessions`} />
        <SummaryMetric
          label="Billable clicks"
          value={numberFormatter.format(billableClicks)}
          hint={totalClicks > 0 ? `${((billableClicks / totalClicks) * 100).toFixed(1)}% billable share` : "No traffic yet"}
          tone="good"
        />
        <SummaryMetric label="Spend" value={formatMoney(spend, currency)} hint={`Avg CPC ${formatMoney(avgCpc, currency)}`} />
        <SummaryMetric label="Outstanding" value={formatMoney(outstandingAmount, currency)} hint={`CTR ${(ctr * 100).toFixed(2)}%`} tone={outstandingAmount > 0 ? "warn" : "good"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div id="company-profile">
          <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Профиль компании
            </CardTitle>
            <span className="text-xs text-muted-foreground">Редактируется в Seller Panel</span>
          </CardHeader>
          <CardContent className="space-y-3">
            {sellerShopQuery.isLoading ? <p className="text-sm text-muted-foreground">Загрузка профиля магазина...</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Название магазина</p>
                <Input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Shop name" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Website</p>
                <Input value={profileWebsite} onChange={(event) => setProfileWebsite(event.target.value)} placeholder="https://example.com" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Email</p>
                <Input value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} type="email" placeholder="sales@example.com" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Phone</p>
                <Input value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} type="tel" placeholder="+998 90 123 45 67" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Logo URL</p>
                <Input value={profileLogoUrl} onChange={(event) => setProfileLogoUrl(event.target.value)} placeholder="https://cdn.example.com/logo.png" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Banner URL</p>
                <Input value={profileBannerUrl} onChange={(event) => setProfileBannerUrl(event.target.value)} placeholder="https://cdn.example.com/banner.jpg" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Brand color</p>
                <Input value={profileBrandColor} onChange={(event) => setProfileBrandColor(event.target.value)} placeholder="#0f766e" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Preview</p>
                <div className="flex h-10 items-center gap-3 rounded-lg border border-border/70 px-3">
                  <span className="h-5 w-5 rounded-full border border-border/80" style={{ backgroundColor: brandColorPreview }} />
                  <span className="text-xs text-muted-foreground">{hasBrandColor ? normalizedBrandColor : "Invalid hex color"}</span>
                </div>
              </div>
            </div>
            {profileMessage ? (
              <p className={cn("text-xs", profileMessage.kind === "error" ? "text-rose-700" : "text-emerald-700")}>{profileMessage.text}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveCompanyProfile()} disabled={updateSellerShopMutation.isPending}>
                {updateSellerShopMutation.isPending ? "Сохраняем..." : "Сохранить профиль"}
              </Button>
              <Link href="/dashboard/seller/onboarding" className={buttonVariants({ variant: "secondary" })}>
                Открыть онбординг
              </Link>
            </div>
          </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Онбординг-подсказки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Готовность кабинета</span>
                <span>{onboardingProgress}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200">
                <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${onboardingProgress}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Выполнено: {onboardingDone}/{onboardingTasks.length}
              </p>
            </div>

            <div className="space-y-2">
              {onboardingTasks.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.hint}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!item.ok ? (
                      <Link
                        href={item.href}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 px-2 text-xs")}
                      >
                        {item.cta}
                      </Link>
                    ) : null}
                    {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <AreaTimeseriesChart
          title="Clicks trend"
          description="Traffic and paid interactions over selected period"
          data={chartSeries}
          dataKey="clicks"
          color="#0f766e"
          valueFormatter={(value) => numberFormatter.format(value)}
        />
        <AreaTimeseriesChart
          title="Spend trend"
          description="Monetization dynamics and CPC accumulation"
          data={chartSeries}
          dataKey="spend"
          color="#0284c7"
          valueFormatter={(value) => formatMoney(value, currency)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              Top monetized offers
            </CardTitle>
            <span className="text-xs text-muted-foreground">{formatMoney(topOffersSpend, currency)} total</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {topOffers.length ? (
              topOffers.map((offer) => (
                <div key={offer.offer_id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <p className="truncate text-sm font-semibold">{offer.offer_id}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <span>Clicks: {numberFormatter.format(offer.clicks)}</span>
                    <span>Billable: {numberFormatter.format(offer.billable_clicks)}</span>
                    <span>Spend: {formatMoney(offer.spend, currency)}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No offer-level analytics yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              Attribution split
            </CardTitle>
            <span className="text-xs text-muted-foreground">{periodDays}d</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {attributionRows.length ? (
              attributionRows.slice(0, 8).map((row, index) => (
                <div key={`${row.source_page}-${row.placement}-${index}`} className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <p className="text-sm font-semibold">
                    {row.source_page} / {row.placement}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <span>Clicks: {numberFormatter.format(row.clicks)}</span>
                    <span>Billable: {numberFormatter.format(row.billable_clicks)}</span>
                    <span>Spend: {formatMoney(row.spend, currency)}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Attribution data is not available yet.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operational checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </div>
                {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              </div>
            ))}

            <div className="grid gap-2 pt-2 md:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                <p className="text-xs text-muted-foreground">Campaigns</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  <Megaphone className="h-4 w-4 text-primary" />
                  {activeCampaigns} active / {campaigns.length} total
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                <p className="text-xs text-muted-foreground">Feeds</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  <PackageCheck className="h-4 w-4 text-primary" />
                  {activeFeeds} active / {feeds.length} total
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                <p className="text-xs text-muted-foreground">Billing risk</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  <CreditCard className="h-4 w-4 text-primary" />
                  {overdueInvoices} overdue invoices
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                <p className="text-xs text-muted-foreground">Support load</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  <MessageSquareWarning className="h-4 w-4 text-primary" />
                  {openTickets} open / in progress
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick support escalation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Subject" value={ticketSubject} onChange={(event) => setTicketSubject(event.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={ticketCategory} onValueChange={setTicketCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="campaign">Campaign</SelectItem>
                  <SelectItem value="feed">Feed quality</SelectItem>
                </SelectContent>
              </Select>
              <Select value={ticketPriority} onValueChange={setTicketPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Describe issue, affected IDs, expected result, and deadline."
              value={ticketBody}
              onChange={(event) => setTicketBody(event.target.value)}
              rows={5}
            />
            {ticketMessage ? <p className="text-xs text-muted-foreground">{ticketMessage}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={createTicket} disabled={createTicketMutation.isPending}>
                {createTicketMutation.isPending ? "Creating..." : "Create ticket"}
              </Button>
              <Link href="/dashboard/seller/support" className={buttonVariants({ variant: "secondary" })}>
                Open full support center
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

