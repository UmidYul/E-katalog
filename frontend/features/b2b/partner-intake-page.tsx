"use client";

import { FormEvent, type ReactNode, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Clock3, Handshake, Link2, SendHorizonal, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";

type LegalType = "individual" | "llc" | "other";
type SubmissionMethod = "api" | "xml" | "excel" | "other";
type ProductCountRange = "lt100" | "100_1000" | "1000_10000" | "10000_plus";
type SellerStatus = "pending" | "review" | "approved" | "rejected";

type SellerForm = {
  shopName: string;
  contactPerson: string;
  legalType: LegalType;
  inn: string;
  legalAddress: string;
  actualAddress: string;
  contactPhone: string;
  contactEmail: string;
  websiteUrl: string;
  categoriesRaw: string;
  submissionMethod: SubmissionMethod;
  productCountRange: ProductCountRange;
  notes: string;
  acceptsTerms: boolean;
};

type FormErrors = Partial<Record<keyof SellerForm, string>>;

type SubmitState =
  | { kind: "idle" }
  | { kind: "pending" }
  | {
      kind: "success";
      mode: "created" | "already_applied";
      applicationId: string;
      message: string;
      status?: SellerStatus;
      reviewNote?: string | null;
    }
  | {
      kind: "error";
      message: string;
      fieldErrors?: Record<string, string> | null;
    };

type StatusLookupState =
  | { kind: "idle" }
  | { kind: "pending" }
  | {
      kind: "success";
      applicationId: string;
      status: SellerStatus;
      reviewNote?: string | null;
      updatedAt?: string | null;
    }
  | { kind: "error"; message: string };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UZ_PHONE_REGEX = /^\+998\d{9}$/;
const STIR_REGEX = /^\d{9}$/;
const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

const STATUS_LABELS: Record<SellerStatus, string> = {
  pending: "Қабул қилинди",
  review: "Кўриб чиқилмоқда",
  approved: "Тасдиқланди",
  rejected: "Рад этилди",
};

const STATUS_STEP_INDEX: Record<SellerStatus, number> = {
  pending: 0,
  review: 1,
  approved: 2,
  rejected: 2,
};

const PROCESS_STEPS = [
  { title: "1-қадам", text: "Ариза юборинг" },
  { title: "2-қадам", text: "Модерация — 2–3 иш куни" },
  { title: "3-қадам", text: "Интеграция — API ёки прайс-лист" },
];

const BENEFITS = [
  {
    icon: <Store className="h-4 w-4" />,
    title: "150 000+ ойлик фаол фойдаланувчи",
    text: "Сизга тайёр аудитория ва юқори ниятли харидорлар оқими.",
  },
  {
    icon: <Link2 className="h-4 w-4" />,
    title: "Бепул размещение",
    text: "Нархларни интеграция орқали юборинг ва каталогда текин жойлашинг.",
  },
  {
    icon: <BarChart3 className="h-4 w-4" />,
    title: "Нарх мониторинги ва аналитика — бепул",
    text: "Бозорда позициянгизни кузатинг ва рақобат нархларини солиштиринг.",
  },
  {
    icon: <Handshake className="h-4 w-4" />,
    title: "Тошкентдаги асосий техника агрегатори",
    text: "Doxx орқали брендингизни ишончли муҳитда намоён қилинг.",
  },
];

const DEFAULT_FORM: SellerForm = {
  shopName: "",
  contactPerson: "",
  legalType: "llc",
  inn: "",
  legalAddress: "",
  actualAddress: "",
  contactPhone: "",
  contactEmail: "",
  websiteUrl: "",
  categoriesRaw: "",
  submissionMethod: "api",
  productCountRange: "100_1000",
  notes: "",
  acceptsTerms: false,
};

type SellerSubmitResponse = {
  ok: boolean;
  mode?: "created" | "already_applied";
  applicationId?: string;
  status?: SellerStatus;
  reviewNote?: string | null;
  message?: string;
  fieldErrors?: Record<string, string>;
};

type SellerStatusResponse = {
  ok: boolean;
  applicationId?: string;
  status?: SellerStatus;
  reviewNote?: string | null;
  updatedAt?: string;
  message?: string;
};

export function PartnerIntakePage() {
  const [form, setForm] = useState<SellerForm>(DEFAULT_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [statusState, setStatusState] = useState<StatusLookupState>({ kind: "idle" });

  const categories = useMemo(
    () =>
      form.categoriesRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20),
    [form.categoriesRaw],
  );

  const canSubmit = useMemo(() => {
    if (submitState.kind === "pending") return false;
    if (!form.acceptsTerms) return false;
    return (
      form.shopName.trim().length >= 2 &&
      form.contactPerson.trim().length >= 2 &&
      STIR_REGEX.test(form.inn.trim()) &&
      form.legalAddress.trim().length >= 3 &&
      UZ_PHONE_REGEX.test(form.contactPhone.trim()) &&
      EMAIL_REGEX.test(form.contactEmail.trim().toLowerCase()) &&
      categories.length > 0 &&
      form.submissionMethod.length > 0 &&
      form.productCountRange.length > 0 &&
      (!form.websiteUrl.trim() || URL_REGEX.test(form.websiteUrl.trim()))
    );
  }, [categories.length, form, submitState.kind]);

  const validate = () => {
    const nextErrors: FormErrors = {};
    if (form.shopName.trim().length < 2) nextErrors.shopName = "Дўкон номи камида 2 та белгидан иборат бўлиши керак.";
    if (form.contactPerson.trim().length < 2) nextErrors.contactPerson = "Контакт шахсни тўлиқ киритинг.";
    if (!STIR_REGEX.test(form.inn.trim())) nextErrors.inn = "СТИР аниқ 9 та рақамдан иборат бўлиши керак.";
    if (form.legalAddress.trim().length < 3) nextErrors.legalAddress = "Юридик манзилни киритинг.";
    if (!UZ_PHONE_REGEX.test(form.contactPhone.trim())) {
      nextErrors.contactPhone = "Телефон +998XXXXXXXXX форматида бўлиши керак.";
    }
    if (!EMAIL_REGEX.test(form.contactEmail.trim().toLowerCase())) {
      nextErrors.contactEmail = "Тўғри email киритинг.";
    }
    if (form.websiteUrl.trim() && !URL_REGEX.test(form.websiteUrl.trim())) {
      nextErrors.websiteUrl = "Сайт манзили https://... форматида бўлиши керак.";
    }
    if (!categories.length) nextErrors.categoriesRaw = "Камида битта товар категориясини киритинг.";
    if (!form.acceptsTerms) nextErrors.acceptsTerms = "Шартлар ва махфийлик сиёсати қабул қилиниши шарт.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitState({ kind: "idle" });

    if (!validate()) return;

    setSubmitState({ kind: "pending" });
    try {
      const response = await fetch("/api/seller-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_name: form.shopName.trim(),
          contact_person: form.contactPerson.trim(),
          legal_type: form.legalType,
          inn: form.inn.trim(),
          legal_address: form.legalAddress.trim(),
          actual_address: form.actualAddress.trim() || null,
          contact_phone: form.contactPhone.trim(),
          contact_email: form.contactEmail.trim().toLowerCase(),
          website_url: form.websiteUrl.trim() || null,
          product_categories: categories,
          accepts_terms: form.acceptsTerms,
          submission_method: form.submissionMethod,
          estimated_product_count_range: form.productCountRange,
          notes: form.notes.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as SellerSubmitResponse;
      if (!response.ok || !payload.ok || !payload.applicationId || !payload.mode) {
        const maybeFieldErrors = payload.fieldErrors ?? null;
        setSubmitState({
          kind: "error",
          message: payload.message ?? "Ариза юборилмади. Майдонларни текшириб, қайта уриниб кўринг.",
          fieldErrors: maybeFieldErrors,
        });
        if (maybeFieldErrors) {
          setErrors((prev) => ({
            ...prev,
            inn: maybeFieldErrors.inn ?? prev.inn,
            contactEmail: maybeFieldErrors.contact_email ?? prev.contactEmail,
            contactPhone: maybeFieldErrors.contact_phone ?? prev.contactPhone,
            websiteUrl: maybeFieldErrors.website_url ?? prev.websiteUrl,
          }));
        }
        return;
      }

      setLookupEmail(form.contactEmail.trim().toLowerCase());
      setLookupId(payload.applicationId);
      setSubmitState({
        kind: "success",
        mode: payload.mode,
        applicationId: payload.applicationId,
        message: payload.message ?? "Ариза қабул қилинди.",
        status: payload.status,
        reviewNote: payload.reviewNote ?? null,
      });
      setStatusState({
        kind: "success",
        applicationId: payload.applicationId,
        status: payload.status ?? "pending",
        reviewNote: payload.reviewNote ?? null,
        updatedAt: null,
      });
    } catch {
      setSubmitState({
        kind: "error",
        message: "Ариза юборишда техник хатолик юз берди. Илтимос, қайта уриниб кўринг.",
      });
    }
  };

  const lookupStatus = async () => {
    const email = lookupEmail.trim().toLowerCase();
    const id = lookupId.trim();

    if (!email && !id) {
      setStatusState({ kind: "error", message: "Email ёки Ариза ID киритинг." });
      return;
    }

    setStatusState({ kind: "pending" });
    try {
      const params = new URLSearchParams();
      if (email) params.set("email", email);
      if (id) params.set("id", id);

      const response = await fetch(`/api/seller-applications/status?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as SellerStatusResponse;
      if (!response.ok || !payload.ok || !payload.applicationId || !payload.status) {
        setStatusState({
          kind: "error",
          message: payload.message ?? "Статус топилмади. Email ёки ID ни текширинг.",
        });
        return;
      }

      setStatusState({
        kind: "success",
        applicationId: payload.applicationId,
        status: payload.status,
        reviewNote: payload.reviewNote ?? null,
        updatedAt: payload.updatedAt ?? null,
      });
    } catch {
      setStatusState({
        kind: "error",
        message: "Статусни олишда хатолик юз берди.",
      });
    }
  };

  const handleResetForRetry = () => {
    setForm(DEFAULT_FORM);
    setErrors({});
    setSubmitState({ kind: "idle" });
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:py-10">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Сотувчи бўлиш</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Doxx’га уланиб, товарларингизни кўпроқ мижозларга кўрсатинг. Ариза ва интеграция жараёни оддий ва шаффоф.
        </p>
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BENEFITS.map((item) => (
          <Card key={item.title} className="border-accent/20">
            <CardContent className="space-y-2 p-4">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">{item.icon}</span>
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.text}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold">Қандай ишлайди</p>
        <div className="grid gap-3 md:grid-cols-3">
          {PROCESS_STEPS.map((step, index) => (
            <div key={step.title} className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent">{step.title}</p>
              <p className="mt-1 text-sm">{step.text}</p>
              {index < PROCESS_STEPS.length - 1 ? <p className="mt-2 text-xs text-muted-foreground">→</p> : null}
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Ариза формаси</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Дўкон номи *" error={errors.shopName}>
                  <Input
                    value={form.shopName}
                    onChange={(event) => setForm((prev) => ({ ...prev, shopName: event.target.value }))}
                    placeholder="Масалан: Techno Mall"
                  />
                </Field>
                <Field label="Контакт шахс *" error={errors.contactPerson}>
                  <Input
                    value={form.contactPerson}
                    onChange={(event) => setForm((prev) => ({ ...prev, contactPerson: event.target.value }))}
                    placeholder="Исм Фамилия"
                  />
                </Field>
                <Field label="Юридик шакл">
                  <Select
                    value={form.legalType}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, legalType: value as LegalType }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="individual">ЯТТ</SelectItem>
                      <SelectItem value="llc">МЧЖ</SelectItem>
                      <SelectItem value="other">Бошқа</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="СТИР *" error={errors.inn}>
                  <Input
                    value={form.inn}
                    onChange={(event) => setForm((prev) => ({ ...prev, inn: event.target.value.replace(/\D/g, "").slice(0, 9) }))}
                    placeholder="9 рақам"
                    inputMode="numeric"
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Юридик манзил *" error={errors.legalAddress} className="sm:col-span-2">
                  <Input
                    value={form.legalAddress}
                    onChange={(event) => setForm((prev) => ({ ...prev, legalAddress: event.target.value }))}
                    placeholder="Тошкент ш., ... "
                  />
                </Field>
                <Field label="Фактик манзил">
                  <Input
                    value={form.actualAddress}
                    onChange={(event) => setForm((prev) => ({ ...prev, actualAddress: event.target.value }))}
                    placeholder="Ихтиёрий"
                  />
                </Field>
                <Field label="Веб-сайт (ихтиёрий)" error={errors.websiteUrl}>
                  <Input
                    value={form.websiteUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, websiteUrl: event.target.value }))}
                    placeholder="https://example.uz"
                    type="url"
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Телефон *" error={errors.contactPhone}>
                  <Input
                    value={form.contactPhone}
                    onChange={(event) => setForm((prev) => ({ ...prev, contactPhone: event.target.value }))}
                    placeholder="+998901234567"
                    type="tel"
                  />
                </Field>
                <Field label="Email *" error={errors.contactEmail}>
                  <Input
                    value={form.contactEmail}
                    onChange={(event) => setForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
                    placeholder="sales@example.uz"
                    type="email"
                  />
                </Field>
              </div>

              <Field label="Категориялар * (вергул билан)">
                <Input
                  value={form.categoriesRaw}
                  onChange={(event) => setForm((prev) => ({ ...prev, categoriesRaw: event.target.value }))}
                  placeholder="смартфонлар, ноутбуклар, телевизорлар"
                />
                {errors.categoriesRaw ? <p className="mt-1 text-xs text-rose-600">{errors.categoriesRaw}</p> : null}
              </Field>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Нархларни қандай юборасиз? *</p>
                <RadioGroup<SubmissionMethod>
                  value={form.submissionMethod}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, submissionMethod: value }))}
                  options={[
                    { value: "api", label: "API интеграция" },
                    { value: "xml", label: "YML/XML прайс-лист" },
                    { value: "excel", label: "Excel юклаш" },
                    { value: "other", label: "Бошқа" },
                  ]}
                />
              </div>

              <Field label="Тахминий товар сони *">
                <Select
                  value={form.productCountRange}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, productCountRange: value as ProductCountRange }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lt100">100 гача</SelectItem>
                    <SelectItem value="100_1000">100–1000</SelectItem>
                    <SelectItem value="1000_10000">1000–10 000</SelectItem>
                    <SelectItem value="10000_plus">10 000+</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Қўшимча изоҳ">
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Қўшимча маълумот, интеграция истаклари ва ҳ.к."
                />
              </Field>

              <label className="inline-flex items-start gap-2 text-sm">
                <Checkbox
                  checked={form.acceptsTerms}
                  onCheckedChange={(value) => setForm((prev) => ({ ...prev, acceptsTerms: Boolean(value) }))}
                />
                <span>Ҳамкорлик шартлари ва махфийлик сиёсатига розиман *</span>
              </label>
              {errors.acceptsTerms ? <p className="text-xs text-rose-600">{errors.acceptsTerms}</p> : null}

              {submitState.kind === "success" ? (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <p className="inline-flex items-center gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    {submitState.message}
                  </p>
                  <p className="mt-1 text-xs">Ариза ID: {submitState.applicationId}</p>
                  {submitState.mode === "already_applied" && submitState.status ? (
                    <p className="mt-1 text-xs">Жорий ҳолат: {STATUS_LABELS[submitState.status]}</p>
                  ) : null}
                </div>
              ) : null}
              {submitState.kind === "error" ? (
                <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{submitState.message}</p>
              ) : null}

              <Button type="submit" disabled={!canSubmit}>
                {submitState.kind === "pending" ? "Юборилмоқда..." : "Ариза юбориш"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Ариза ҳолати</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Email">
              <Input
                value={lookupEmail}
                onChange={(event) => setLookupEmail(event.target.value)}
                placeholder="company@example.uz"
                type="email"
              />
            </Field>
            <Field label="Ариза ID">
              <Input value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="UUID..." />
            </Field>
            <Button type="button" variant="secondary" onClick={() => void lookupStatus()} disabled={statusState.kind === "pending"}>
              {statusState.kind === "pending" ? "Текширилмоқда..." : "Статусни текшириш"}
            </Button>

            {statusState.kind === "error" ? (
              <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{statusState.message}</p>
            ) : null}

            {statusState.kind === "success" ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Ариза ID: {statusState.applicationId}</p>
                <StatusStepper status={statusState.status} />
                {statusState.status === "rejected" ? (
                  <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50 p-2.5">
                    <p className="text-sm font-medium text-rose-700">Ариза рад этилди</p>
                    <p className="text-xs text-rose-700">
                      Сабаб: {statusState.reviewNote?.trim() || "Қўшимча изоҳ берилмаган."}
                    </p>
                    <Button type="button" variant="outline" onClick={handleResetForRetry}>
                      Қайта ариза юбориш
                    </Button>
                  </div>
                ) : null}
                {statusState.status !== "rejected" && statusState.reviewNote ? (
                  <p className="text-xs text-muted-foreground">Изоҳ: {statusState.reviewNote}</p>
                ) : null}
                {statusState.updatedAt ? (
                  <p className="text-xs text-muted-foreground">Янгиланди: {new Date(statusState.updatedAt).toLocaleString("ru-RU")}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Email ёки Ариза ID орқали жараённи кузатинг: Қабул қилинди → Кўриб чиқилмоқда → Тасдиқланди/Рад этилди.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
  error,
  className,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

function StatusStepper({ status }: { status: SellerStatus }) {
  const currentIndex = STATUS_STEP_INDEX[status];
  const isRejected = status === "rejected";
  const steps = [
    { id: "pending", label: "Қабул қилинди", icon: <SendHorizonal className="h-3.5 w-3.5" /> },
    { id: "review", label: "Кўриб чиқилмоқда", icon: <Clock3 className="h-3.5 w-3.5" /> },
    { id: "final", label: isRejected ? "Рад этилди" : "Тасдиқланди", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const reached = index <= currentIndex;
        const danger = isRejected && index === 2;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                reached ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground",
                danger && "border-rose-300 bg-rose-100 text-rose-700",
              )}
            >
              {step.icon}
            </span>
            <span className={cn("text-sm", reached ? "text-foreground" : "text-muted-foreground", danger && "text-rose-700")}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
