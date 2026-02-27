"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, CheckCircle2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateB2BPartnerLead } from "@/features/b2b/use-b2b";

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);

export function PartnerIntakePage() {
  const submitLeadMutation = useCreateB2BPartnerLead();

  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [countryCode, setCountryCode] = useState("UZ");
  const [city, setCity] = useState("");

  const [categoriesRaw, setCategoriesRaw] = useState("");
  const [monthlyOrders, setMonthlyOrders] = useState("");
  const [avgOrderValue, setAvgOrderValue] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [logisticsModel, setLogisticsModel] = useState<"own_warehouse" | "dropshipping" | "marketplace_fulfillment" | "hybrid">(
    "own_warehouse",
  );
  const [warehousesCount, setWarehousesCount] = useState("");
  const [marketplacesRaw, setMarketplacesRaw] = useState("");
  const [returnsPolicy, setReturnsPolicy] = useState("");
  const [goals, setGoals] = useState("");
  const [notes, setNotes] = useState("");
  const [acceptsTerms, setAcceptsTerms] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [submittedLeadId, setSubmittedLeadId] = useState<string | null>(null);

  const categoriesPreview = useMemo(() => parseList(categoriesRaw), [categoriesRaw]);
  const marketplacesPreview = useMemo(() => parseList(marketplacesRaw), [marketplacesRaw]);

  const submitLead = () => {
    setFormMessage(null);
    setSubmittedLeadId(null);
    if (!companyName.trim() || !contactName.trim() || !email.trim() || !phone.trim()) {
      setFormMessage("Company, contact person, email, and phone are required.");
      return;
    }
    if (!acceptsTerms) {
      setFormMessage("You must accept terms to submit the partner application.");
      return;
    }

    submitLeadMutation.mutate(
      {
        company_name: companyName.trim(),
        legal_name: legalName.trim() || undefined,
        brand_name: brandName.trim() || undefined,
        tax_id: taxId.trim() || undefined,
        website_url: websiteUrl.trim() || undefined,
        contact_name: contactName.trim(),
        contact_role: contactRole.trim() || undefined,
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        telegram: telegram.trim() || undefined,
        country_code: countryCode.trim().toUpperCase(),
        city: city.trim() || undefined,
        categories: categoriesPreview,
        monthly_orders: monthlyOrders.trim() ? Math.max(0, Number(monthlyOrders)) : undefined,
        avg_order_value: avgOrderValue.trim() ? Math.max(0, Number(avgOrderValue)) : undefined,
        feed_url: feedUrl.trim() || undefined,
        logistics_model: logisticsModel,
        warehouses_count: warehousesCount.trim() ? Math.max(0, Number(warehousesCount)) : undefined,
        marketplaces: marketplacesPreview,
        returns_policy: returnsPolicy.trim() || undefined,
        goals: goals.trim() || undefined,
        notes: notes.trim() || undefined,
        accepts_terms: true,
      },
      {
        onSuccess: (lead) => {
          setSubmittedLeadId(lead.id);
          setFormMessage("Application submitted. Our B2B team will review and contact you.");
        },
        onError: () => {
          setFormMessage("Failed to submit application. Please verify fields and try again.");
        },
      },
    );
  };

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-3xl border border-sky-200/70 bg-gradient-to-br from-sky-100 via-cyan-50 to-emerald-100 p-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-sky-300/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-900">
            <Building2 className="h-3.5 w-3.5" />
            Partner onboarding
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Become a marketplace partner</h1>
          <p className="mt-2 text-sm text-slate-700">
            Fill in the full business profile. The admin team reviews applications in B2B control center and approves/rejects them with audit notes.
          </p>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Company and legal profile</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Company name *" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
            <Input placeholder="Legal company name" value={legalName} onChange={(event) => setLegalName(event.target.value)} />
            <Input placeholder="Brand name" value={brandName} onChange={(event) => setBrandName(event.target.value)} />
            <Input placeholder="Tax ID / INN" value={taxId} onChange={(event) => setTaxId(event.target.value)} />
            <Input placeholder="Website URL" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} className="sm:col-span-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact and operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Contact person *" value={contactName} onChange={(event) => setContactName(event.target.value)} />
              <Input placeholder="Role (CEO, Head of Sales...)" value={contactRole} onChange={(event) => setContactRole(event.target.value)} />
              <Input placeholder="Work email *" value={email} onChange={(event) => setEmail(event.target.value)} />
              <Input placeholder="Phone *" value={phone} onChange={(event) => setPhone(event.target.value)} />
              <Input placeholder="Telegram" value={telegram} onChange={(event) => setTelegram(event.target.value)} />
              <Input placeholder="Country code (UZ)" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} />
              <Input placeholder="City" value={city} onChange={(event) => setCity(event.target.value)} />
              <Input placeholder="Feed URL (XML/CSV/API)" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} />
              <Input
                placeholder="Categories (comma separated)"
                value={categoriesRaw}
                onChange={(event) => setCategoriesRaw(event.target.value)}
                className="sm:col-span-2"
              />
              <Input placeholder="Marketplaces (comma separated)" value={marketplacesRaw} onChange={(event) => setMarketplacesRaw(event.target.value)} />
              <Input
                type="number"
                min={0}
                placeholder="Monthly orders"
                value={monthlyOrders}
                onChange={(event) => setMonthlyOrders(event.target.value)}
              />
              <Input
                type="number"
                min={0}
                placeholder="Avg order value (UZS)"
                value={avgOrderValue}
                onChange={(event) => setAvgOrderValue(event.target.value)}
              />
              <Input
                type="number"
                min={0}
                placeholder="Warehouses count"
                value={warehousesCount}
                onChange={(event) => setWarehousesCount(event.target.value)}
              />
            </div>

            <Select value={logisticsModel} onValueChange={(value) => setLogisticsModel(value as typeof logisticsModel)}>
              <SelectTrigger>
                <SelectValue placeholder="Logistics model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="own_warehouse">Own warehouse</SelectItem>
                <SelectItem value="dropshipping">Dropshipping</SelectItem>
                <SelectItem value="marketplace_fulfillment">Marketplace fulfillment</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>

            <Textarea
              rows={3}
              placeholder="Returns policy and SLA"
              value={returnsPolicy}
              onChange={(event) => setReturnsPolicy(event.target.value)}
            />
            <Textarea rows={3} placeholder="Goals on E-katalog (traffic, sales, categories)" value={goals} onChange={(event) => setGoals(event.target.value)} />
            <Textarea rows={4} placeholder="Additional notes" value={notes} onChange={(event) => setNotes(event.target.value)} />

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={acceptsTerms} onCheckedChange={(value) => setAcceptsTerms(Boolean(value))} />
              I confirm data accuracy and agree to partner onboarding terms.
            </label>

            {categoriesPreview.length ? <p className="text-xs text-muted-foreground">categories: {categoriesPreview.join(", ")}</p> : null}
            {marketplacesPreview.length ? <p className="text-xs text-muted-foreground">marketplaces: {marketplacesPreview.join(", ")}</p> : null}
            {formMessage ? <p className="text-xs text-muted-foreground">{formMessage}</p> : null}
            {submittedLeadId ? (
              <p className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Lead ID: {submittedLeadId}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={submitLead} disabled={submitLeadMutation.isPending}>
                <Send className="mr-1 h-4 w-4" />
                {submitLeadMutation.isPending ? "Submitting..." : "Submit application"}
              </Button>
              <Link href="/seller" className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm">
                Open Seller Panel
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
