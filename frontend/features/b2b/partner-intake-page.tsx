"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSellerApplication, useSellerApplicationStatus } from "@/features/seller/use-seller";

type FieldErrors = Partial<Record<"shop_name" | "inn" | "legal_address" | "contact_phone" | "contact_email" | "website_url" | "product_categories", string>>;

const statusLabel: Record<string, string> = {
  pending: "На рассмотрении",
  review: "В работе у менеджера",
  approved: "Одобрено",
  rejected: "Отклонено",
};

export function PartnerIntakePage() {
  const createApplication = useCreateSellerApplication();
  const [shopName, setShopName] = useState("");
  const [legalType, setLegalType] = useState<"individual" | "llc" | "other">("individual");
  const [inn, setInn] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [actualAddress, setActualAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [hasWebsite, setHasWebsite] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [workType, setWorkType] = useState<"online" | "offline" | "both">("online");
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);
  const [pickupAvailable, setPickupAvailable] = useState(false);
  const [categoriesRaw, setCategoriesRaw] = useState("");
  const [notes, setNotes] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitMessage, setSubmitMessage] = useState<string>("");
  const [submittedApplicationId, setSubmittedApplicationId] = useState<string>("");
  const [lookup, setLookup] = useState<{ email: string; phone: string } | null>(null);
  const statusQuery = useSellerApplicationStatus(lookup ?? undefined);

  const categories = categoriesRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);

  const validate = () => {
    const nextErrors: FieldErrors = {};
    if (!shopName.trim() || shopName.trim().length < 2) nextErrors.shop_name = "Введите название магазина (минимум 2 символа).";
    if (!inn.trim() || inn.trim().length < 9) nextErrors.inn = "Введите корректный ИНН (минимум 9 символов).";
    if (!legalAddress.trim() || legalAddress.trim().length < 3) nextErrors.legal_address = "Введите юридический адрес.";
    if (!contactPhone.trim() || contactPhone.trim().length < 7) nextErrors.contact_phone = "Введите корректный телефон.";
    if (!contactEmail.trim() || !contactEmail.includes("@")) nextErrors.contact_email = "Введите корректный email.";
    if (hasWebsite && websiteUrl.trim() && !/^https?:\/\//i.test(websiteUrl.trim())) {
      nextErrors.website_url = "URL сайта должен начинаться с http:// или https://";
    }
    if (!categories.length) nextErrors.product_categories = "Укажите хотя бы одну категорию товаров.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submit = async () => {
    setSubmitMessage("");
    setSubmittedApplicationId("");
    if (!validate()) return;
    try {
      const created = await createApplication.mutateAsync({
        shop_name: shopName.trim(),
        legal_type: legalType,
        inn: inn.trim(),
        legal_address: legalAddress.trim(),
        actual_address: actualAddress.trim() || undefined,
        contact_phone: contactPhone.trim(),
        contact_email: contactEmail.trim().toLowerCase(),
        has_website: hasWebsite,
        website_url: hasWebsite ? websiteUrl.trim() || undefined : undefined,
        work_type: workType,
        delivery_available: deliveryAvailable,
        pickup_available: pickupAvailable,
        product_categories: categories,
        documents: notes.trim() ? [{ note: notes.trim() }] : [],
      });
      setSubmittedApplicationId(created.id);
      setLookup({ email: contactEmail.trim().toLowerCase(), phone: contactPhone.trim() });
      setSubmitMessage("Заявка отправлена. Проверка обычно занимает 1-3 рабочих дня.");
    } catch {
      setSubmitMessage("Не удалось отправить заявку. Проверьте поля и попробуйте снова.");
    }
  };

  return (
    <div className="container py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-3xl border border-sky-200/70 bg-gradient-to-br from-sky-100 via-cyan-50 to-emerald-100 p-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-sky-300/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-900">
            <Building2 className="h-3.5 w-3.5" />
            Seller onboarding
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Стать продавцом</h1>
          <p className="mt-2 text-sm text-slate-700">Заполните анкету. После одобрения и завершения provisioning доступ к seller panel откроется автоматически.</p>
          <Link href="/become-seller/pending" className="mt-3 inline-flex text-sm font-medium text-sky-900 underline underline-offset-4">
            Как проходит проверка заявки
          </Link>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Данные компании</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Input value={shopName} onChange={(event) => setShopName(event.target.value)} placeholder="Название магазина" />
              {errors.shop_name ? <p className="mt-1 text-xs text-rose-700">{errors.shop_name}</p> : null}
            </div>
            <Select value={legalType} onValueChange={(value) => setLegalType(value as "individual" | "llc" | "other")}>
              <SelectTrigger>
                <SelectValue placeholder="Тип юрлица" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">ИП / физлицо</SelectItem>
                <SelectItem value="llc">ООО</SelectItem>
                <SelectItem value="other">Другое</SelectItem>
              </SelectContent>
            </Select>
            <div>
              <Input value={inn} onChange={(event) => setInn(event.target.value)} placeholder="ИНН" />
              {errors.inn ? <p className="mt-1 text-xs text-rose-700">{errors.inn}</p> : null}
            </div>
            <div>
              <Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="Контактный телефон" />
              {errors.contact_phone ? <p className="mt-1 text-xs text-rose-700">{errors.contact_phone}</p> : null}
            </div>
            <div className="sm:col-span-2">
              <Input value={legalAddress} onChange={(event) => setLegalAddress(event.target.value)} placeholder="Юридический адрес" />
              {errors.legal_address ? <p className="mt-1 text-xs text-rose-700">{errors.legal_address}</p> : null}
            </div>
            <Input value={actualAddress} onChange={(event) => setActualAddress(event.target.value)} placeholder="Фактический адрес (опционально)" />
            <div>
              <Input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="Контактный email" />
              {errors.contact_email ? <p className="mt-1 text-xs text-rose-700">{errors.contact_email}</p> : null}
            </div>
            <div className="sm:col-span-2 flex items-center gap-2 text-sm">
              <Checkbox checked={hasWebsite} onCheckedChange={(value) => setHasWebsite(Boolean(value))} />
              Есть сайт компании
            </div>
            {hasWebsite ? (
              <div className="sm:col-span-2">
                <Input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://example.uz" />
                {errors.website_url ? <p className="mt-1 text-xs text-rose-700">{errors.website_url}</p> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Формат работы</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={workType} onValueChange={(value) => setWorkType(value as "online" | "offline" | "both")}>
              <SelectTrigger>
                <SelectValue placeholder="Канал продаж" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="online">Только онлайн</SelectItem>
                <SelectItem value="offline">Только офлайн</SelectItem>
                <SelectItem value="both">Онлайн + офлайн</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex flex-wrap items-center gap-6 text-sm">
              <label className="inline-flex items-center gap-2">
                <Checkbox checked={deliveryAvailable} onCheckedChange={(value) => setDeliveryAvailable(Boolean(value))} />
                Доставка
              </label>
              <label className="inline-flex items-center gap-2">
                <Checkbox checked={pickupAvailable} onCheckedChange={(value) => setPickupAvailable(Boolean(value))} />
                Самовывоз
              </label>
            </div>

            <div>
              <Input
                value={categoriesRaw}
                onChange={(event) => setCategoriesRaw(event.target.value)}
                placeholder="Категории через запятую: смартфоны, бытовая техника, мебель"
              />
              {errors.product_categories ? <p className="mt-1 text-xs text-rose-700">{errors.product_categories}</p> : null}
            </div>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Дополнительная информация для модератора (опционально)" />

            {submitMessage ? <p className="text-sm text-muted-foreground">{submitMessage}</p> : null}
            {submittedApplicationId ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <p className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Заявка зарегистрирована: {submittedApplicationId}
                </p>
              </div>
            ) : null}

            <Button onClick={() => void submit()} disabled={createApplication.isPending}>
              {createApplication.isPending ? "Отправка..." : "Отправить заявку"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Статус заявки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => setLookup({ email: contactEmail.trim().toLowerCase(), phone: contactPhone.trim() })}
                disabled={!contactEmail.trim() || !contactPhone.trim()}
              >
                Обновить статус
              </Button>
            </div>

            {statusQuery.data ? (
              <div className="space-y-1 rounded-lg border border-border p-3">
                <p>Статус: {statusLabel[statusQuery.data.status] ?? statusQuery.data.status}</p>
                <p>Provisioning: {statusQuery.data.provisioning_status}</p>
                {statusQuery.data.review_note ? <p>Комментарий: {statusQuery.data.review_note}</p> : null}
                {statusQuery.data.seller_login_url && statusQuery.data.seller_panel_url ? (
                  <a
                    href={statusQuery.data.seller_login_url}
                    className="inline-flex rounded-md border border-emerald-300 px-3 py-1 text-emerald-800"
                  >
                    Открыть Seller Panel
                  </a>
                ) : (
                  <p className="text-muted-foreground">Доступ в seller panel появится после одобрения и готовности provisioning.</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
