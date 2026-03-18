"use client";

import Link from "next/link";
import { FormEvent, type ReactNode, useMemo, useState } from "react";
import { Clock3, Instagram, Mail, MapPin, PhoneCall, Send, ShieldCheck } from "lucide-react";

import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ContactSubject = "general" | "technical" | "partnership" | "other";

type FormState = {
  name: string;
  contact: string;
  subject: ContactSubject;
  message: string;
  website: string;
};

type SubmitState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const EMAIL_OR_PHONE_REGEX =
  /^([^\s@]+@[^\s@]+\.[^\s@]{2,}|(\+998\d{9})|(\+998\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}))$/i;

const subjectLabels: Record<ContactSubject, string> = {
  general: "Умумий савол",
  technical: "Техник муаммо",
  partnership: "Ҳамкорлик",
  other: "Бошқа",
};

const FAQ_ITEMS = [
  {
    id: "faq-sync",
    title: "Нархлар қандай янгиланади?",
    content:
      "Нархлар парсер орқали дўконлардан мунтазам янгиланади. Янгиланиш вақти товар ва дўконга қараб фарқ қилиши мумкин, аммо платформада охирги синхронлаш вақти кўрсатилади.",
  },
  {
    id: "faq-buy",
    title: "Doxx орқали товар сотиб олиш мумкинми?",
    content:
      "Йўқ. Doxx — нархларни солиштириш агрегатори. Сиз энг яхши таклифни танлаб, тўғридан-тўғри дўкон сайтига ўтасиз ва харидни ўша ерда амалга оширасиз.",
  },
  {
    id: "faq-shop-add",
    title: "Дўконим нархларини Doxx'га қандай қўшаман?",
    content:
      "«Сотувчи бўлиш» саҳифасида ариза қолдиринг. Тасдиқдан сўнг API ёки YML/XML прайс-лист орқали интеграция қилиб, товарларингизни чиқаришингиз мумкин.",
  },
  {
    id: "faq-price-error",
    title: "Нарх хатолигини қаерга хабар қиламан?",
    content:
      "Қуйидаги форма орқали ёки support@doxx.uz манзилига ёзинг. Хабарда товар ҳаволаси ва тўғри нархни илова қилсангиз, тезроқ текширамиз.",
  },
];

export function ContactsPageClient() {
  const [form, setForm] = useState<FormState>({
    name: "",
    contact: "",
    subject: "general",
    message: "",
    website: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  const isSubmitDisabled = useMemo(() => {
    if (submitState.kind === "pending") return true;
    return !form.name.trim() || !form.contact.trim() || !form.message.trim();
  }, [form.contact, form.message, form.name, submitState.kind]);

  const validate = () => {
    const nextErrors: Partial<Record<keyof FormState, string>> = {};
    if (form.website.trim()) {
      // Honeypot must stay empty for real users.
      nextErrors.website = "Хавфсизлик текшируви ўтмади.";
    }
    if (form.name.trim().length < 2) {
      nextErrors.name = "Исм камида 2 та белгидан иборат бўлиши керак.";
    }
    if (!EMAIL_OR_PHONE_REGEX.test(form.contact.trim())) {
      nextErrors.contact = "Email ёки +998XXXXXXXXX форматини киритинг.";
    }
    if (form.message.trim().length < 8) {
      nextErrors.message = "Хабар камида 8 та белгидан иборат бўлиши керак.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitState({ kind: "idle" });

    if (!validate()) return;

    setSubmitState({ kind: "pending" });
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          contact: form.contact.trim(),
          subject: form.subject,
          message: form.message.trim(),
          website: form.website.trim(),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setSubmitState({
          kind: "error",
          message: payload.message ?? "Хабар юборишда хатолик юз берди. Илтимос, қайта уриниб кўринг.",
        });
        return;
      }

      setSubmitState({
        kind: "success",
        message: payload.message ?? "Мурожаатингиз қабул қилинди. Жавобни тез орада юборишга ҳаракат қиламиз.",
      });
      setForm((prev) => ({ ...prev, message: "", website: "" }));
      setErrors({});
    } catch {
      setSubmitState({
        kind: "error",
        message: "Хабар юборишда хатолик юз берди. Илтимос, қайта уриниб кўринг.",
      });
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:py-10">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">Алоқа</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Савол, техник муаммо ёки ҳамкорлик бўйича мурожаатларингизни шу ерда қолдиринг. Telegram каналида эса чегирма ва муҳим
          янгиланишларни биринчи бўлиб оласиз.
        </p>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 md:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Боғланиш маълумотлари</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow
              icon={<PhoneCall className="h-4 w-4" />}
              label="Телефон"
              value={
                <a className="underline decoration-accent underline-offset-4" href="tel:+998712099944">
                  +99871 209 99 44
                </a>
              }
            />
            <InfoRow
              icon={<Mail className="h-4 w-4" />}
              label="Қўллаб-қувватлаш"
              value={
                <a className="underline decoration-accent underline-offset-4" href="mailto:support@doxx.uz">
                  support@doxx.uz
                </a>
              }
            />
            <InfoRow
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Хавфсизлик"
              value={
                <a className="underline decoration-accent underline-offset-4" href="mailto:security@doxx.uz">
                  security@doxx.uz
                </a>
              }
            />
            <InfoRow
              icon={<Clock3 className="h-4 w-4" />}
              label="Иш вақти"
              value={<span>Пн–Пт, 9:00–18:00 (Тошкент вақти, UTC+5)</span>}
            />
            <InfoRow icon={<MapPin className="h-4 w-4" />} label="Шаҳар" value={<span>Тошкент, Ўзбекистон</span>} />

            <div className="rounded-xl border border-accent/25 bg-accent/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent">Асосий канал</p>
              <a
                href="https://t.me/doxx_uz"
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-foreground underline decoration-accent underline-offset-4"
              >
                <Send className="h-4 w-4" />
                Telegram канали: @doxx_uz
              </a>
              <p className="mt-1 text-xs text-muted-foreground">Чегирмалар ва муҳим янгиланишлар энг аввал шу ерда.</p>
            </div>

            <div className="pt-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ижтимоий тармоқлар</p>
              <div className="mt-2 flex items-center gap-3">
                <a
                  href="https://t.me/doxx_uz"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-secondary"
                >
                  <Send className="h-4 w-4" />
                  Telegram
                </a>
                <a
                  href="https://instagram.com/doxx.uz"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-secondary"
                >
                  <Instagram className="h-4 w-4" />
                  Instagram
                </a>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Ҳамкорлик аризалари учун <Link href="/become-seller" className="underline underline-offset-4">«Сотувчи бўлиш»</Link>{" "}
              саҳифасидан фойдаланинг.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Мурожаат формаси</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={handleSubmit}>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Исм</p>
                <Input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Исмингизни киритинг"
                />
                {errors.name ? <p className="mt-1 text-xs text-rose-600">{errors.name}</p> : null}
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Email ёки телефон</p>
                <Input
                  value={form.contact}
                  onChange={(event) => setForm((prev) => ({ ...prev, contact: event.target.value }))}
                  placeholder="you@example.com ёки +998901234567"
                />
                {errors.contact ? <p className="mt-1 text-xs text-rose-600">{errors.contact}</p> : null}
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Мавзу</p>
                <Select
                  value={form.subject}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, subject: value as ContactSubject }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Мавзуни танланг" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">{subjectLabels.general}</SelectItem>
                    <SelectItem value="technical">{subjectLabels.technical}</SelectItem>
                    <SelectItem value="partnership">{subjectLabels.partnership}</SelectItem>
                    <SelectItem value="other">{subjectLabels.other}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Хабар</p>
                <Textarea
                  rows={5}
                  value={form.message}
                  onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
                  placeholder="Саволингизни ёки муаммони қисқача ёзинг..."
                />
                {errors.message ? <p className="mt-1 text-xs text-rose-600">{errors.message}</p> : null}
              </div>

              <div className="hidden" aria-hidden>
                <Input
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(event) => setForm((prev) => ({ ...prev, website: event.target.value }))}
                  placeholder="website"
                />
                {errors.website ? <p className="mt-1 text-xs text-rose-600">{errors.website}</p> : null}
              </div>

              {submitState.kind === "success" ? (
                <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{submitState.message}</p>
              ) : null}
              {submitState.kind === "error" ? (
                <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{submitState.message}</p>
              ) : null}

              <Button type="submit" disabled={isSubmitDisabled}>
                {submitState.kind === "pending" ? "Юборилмоқда..." : "Юбориш"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Кўп сўраладиган саволлар</h2>
        <Accordion items={FAQ_ITEMS} />
      </section>
    </main>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/70 p-2.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm text-foreground">{value}</div>
      </div>
    </div>
  );
}
