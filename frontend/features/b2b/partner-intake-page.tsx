"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, CheckCircle2 } from "lucide-react";

import { useLocale } from "@/components/common/locale-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSellerApplication, useSellerApplicationStatus } from "@/features/seller/use-seller";

type FieldErrors = Partial<
  Record<
    "shop_name" | "contact_person" | "inn" | "legal_address" | "contact_phone" | "contact_email" | "website_url" | "product_categories" | "accepts_terms",
    string
  >
>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INN_REGEX = /^\d{9,14}$/;
const PHONE_REGEX = /^\+?[0-9()\s-]{7,20}$/;

export function PartnerIntakePage() {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";

  const statusLabel: Record<string, string> = {
    pending: isUz ? "Кўриб чиқилмоқда" : "На рассмотрении",
    review: isUz ? "Менежер ишламоқда" : "В работе у менеджера",
    approved: isUz ? "Тасдиқланган" : "Одобрено",
    rejected: isUz ? "Рад этилган" : "Отклонено",
  };

  const createApplication = useCreateSellerApplication();
  const [shopName, setShopName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
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
  const [acceptsTerms, setAcceptsTerms] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitMessage, setSubmitMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
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
    if (!shopName.trim() || shopName.trim().length < 2) nextErrors.shop_name = isUz ? "Дўкон номини киритинг (камида 2 белги)." : "Введите название магазина (минимум 2 символа).";
    if (!contactPerson.trim() || contactPerson.trim().length < 2) nextErrors.contact_person = isUz ? "Контакт шахс ФИШни киритинг." : "Введите ФИО контактного лица.";
    if (!INN_REGEX.test(inn.trim())) nextErrors.inn = isUz ? "СТИР 9-14 рақамдан иборат бўлиши керак." : "ИНН должен состоять из 9-14 цифр.";
    if (!legalAddress.trim() || legalAddress.trim().length < 3) nextErrors.legal_address = isUz ? "Юридик манзилни киритинг." : "Введите юридический адрес.";
    if (!PHONE_REGEX.test(contactPhone.trim())) nextErrors.contact_phone = isUz ? "Тўғри телефон рақамини киритинг." : "Введите корректный телефон.";
    if (!EMAIL_REGEX.test(contactEmail.trim().toLowerCase())) nextErrors.contact_email = isUz ? "Тўғри email киритинг." : "Введите корректный email.";
    if (hasWebsite && websiteUrl.trim() && !/^https?:\/\//i.test(websiteUrl.trim())) {
      nextErrors.website_url = isUz ? "Сайт URL'и http:// ёки https:// билан бошланиши керак." : "URL сайта должен начинаться с http:// или https://";
    }
    if (!categories.length) nextErrors.product_categories = isUz ? "Камида битта товар категориясини кўрсатинг." : "Укажите хотя бы одну категорию товаров.";
    if (!acceptsTerms) nextErrors.accepts_terms = isUz ? "Ҳамкорлик шартлари ва махфийлик сиёсатини қабул қилиш керак." : "Нужно принять условия партнёрства и политику конфиденциальности.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submit = async () => {
    setSubmitMessage(null);
    setSubmittedApplicationId("");
    if (!validate()) return;
    try {
      const created = await createApplication.mutateAsync({
        shop_name: shopName.trim(),
        contact_person: contactPerson.trim(),
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
        accepts_terms: acceptsTerms,
      });
      setSubmittedApplicationId(created.id);
      setLookup({ email: contactEmail.trim().toLowerCase(), phone: contactPhone.trim() });
      setSubmitMessage({
        kind: "success",
        text: isUz ? "Раҳмат! Ариза юборилди. Маълумотларни текшириб, 1-3 иш куни ичида сиз билан боғланамиз." : "Спасибо! Заявка отправлена. Мы проверим данные и свяжемся с вами в течение 1-3 рабочих дней.",
      });
    } catch {
      setSubmitMessage({
        kind: "error",
        text: isUz ? "Аризани юбориб бўлмади. Мажбурий майдонларни текшириб, қайта уриниб кўринг." : "Не удалось отправить заявку. Проверьте обязательные поля и попробуйте снова.",
      });
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-3xl border border-sky-200/70 bg-gradient-to-br from-sky-100 via-cyan-50 to-emerald-100 p-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-sky-300/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-900">
            <Building2 className="h-3.5 w-3.5" />
            {isUz ? "Сотувчи онбординги" : "Онбординг продавца"}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{isUz ? "Сотувчи бўлиш" : "Стать продавцом"}</h1>
          <p className="mt-2 text-sm text-slate-700">{isUz ? "Анкетани тўлдиринг. Тасдиқ ва тайёрлаш тугагач, сотувчи кабинетига кириш автоматик очилади." : "Заполните анкету. После одобрения и завершения подготовки доступ к кабинету продавца откроется автоматически."}</p>
          <Link href="/become-seller/pending" className="mt-3 inline-flex text-sm font-medium text-sky-900 underline underline-offset-4">
            {isUz ? "Ариза текшируви қандай ўтади" : "Как проходит проверка заявки"}
          </Link>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>{isUz ? "Компания маълумотлари" : "Данные компании"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">
                {isUz ? "Дўкон номи" : "Название магазина"} <span className="text-rose-600">*</span>
              </p>
              <Input value={shopName} onChange={(event) => setShopName(event.target.value)} placeholder={isUz ? "Дўкон номи" : "Название магазина"} />
              {errors.shop_name ? <p className="mt-1 text-xs text-rose-700">{errors.shop_name}</p> : null}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">
                {isUz ? "Контакт шахс" : "Контактное лицо"} <span className="text-rose-600">*</span>
              </p>
              <Input value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} placeholder={isUz ? "Масъул менежер ФИШ" : "ФИО ответственного менеджера"} />
              {errors.contact_person ? <p className="mt-1 text-xs text-rose-700">{errors.contact_person}</p> : null}
            </div>
            <Select value={legalType} onValueChange={(value) => setLegalType(value as "individual" | "llc" | "other")}>
              <SelectTrigger>
                <SelectValue placeholder={isUz ? "Юр.шахс тури" : "Тип юрлица"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">{isUz ? "ЯТТ / жисмоний шахс" : "ИП / физлицо"}</SelectItem>
                <SelectItem value="llc">{isUz ? "МЧЖ" : "ООО"}</SelectItem>
                <SelectItem value="other">{isUz ? "Бошқа" : "Другое"}</SelectItem>
              </SelectContent>
            </Select>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">
                {isUz ? "СТИР" : "ИНН"} <span className="text-rose-600">*</span>
              </p>
              <Input value={inn} onChange={(event) => setInn(event.target.value)} placeholder={isUz ? "СТИР" : "ИНН"} />
              {errors.inn ? <p className="mt-1 text-xs text-rose-700">{errors.inn}</p> : null}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">
                {isUz ? "Контакт телефон" : "Контактный телефон"} <span className="text-rose-600">*</span>
              </p>
              <Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="+998 90 123 45 67" type="tel" />
              {errors.contact_phone ? <p className="mt-1 text-xs text-rose-700">{errors.contact_phone}</p> : null}
            </div>
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs font-medium text-slate-700">
                {isUz ? "Юридик манзил" : "Юридический адрес"} <span className="text-rose-600">*</span>
              </p>
              <Input value={legalAddress} onChange={(event) => setLegalAddress(event.target.value)} placeholder={isUz ? "Юридик манзил" : "Юридический адрес"} />
              {errors.legal_address ? <p className="mt-1 text-xs text-rose-700">{errors.legal_address}</p> : null}
            </div>
            <Input value={actualAddress} onChange={(event) => setActualAddress(event.target.value)} placeholder={isUz ? "Фактик манзил (ихтиёрий)" : "Фактический адрес (опционально)"} />
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">
                {isUz ? "Контакт email" : "Контактный email"} <span className="text-rose-600">*</span>
              </p>
              <Input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="sales@example.uz" type="email" />
              {errors.contact_email ? <p className="mt-1 text-xs text-rose-700">{errors.contact_email}</p> : null}
            </div>
            <div className="sm:col-span-2 flex items-center gap-2 text-sm">
              <Checkbox checked={hasWebsite} onCheckedChange={(value) => setHasWebsite(Boolean(value))} />
              {isUz ? "Компания сайти бор" : "Есть сайт компании"}
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
            <CardTitle>{isUz ? "Иш формати" : "Формат работы"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={workType} onValueChange={(value) => setWorkType(value as "online" | "offline" | "both")}>
              <SelectTrigger>
                <SelectValue placeholder={isUz ? "Сотув канали" : "Канал продаж"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="online">{isUz ? "Фақат онлайн" : "Только онлайн"}</SelectItem>
                <SelectItem value="offline">{isUz ? "Фақат офлайн" : "Только офлайн"}</SelectItem>
                <SelectItem value="both">{isUz ? "Онлайн + офлайн" : "Онлайн + офлайн"}</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex flex-wrap items-center gap-6 text-sm">
              <label className="inline-flex items-center gap-2">
                <Checkbox checked={deliveryAvailable} onCheckedChange={(value) => setDeliveryAvailable(Boolean(value))} />
                {isUz ? "Етказиб бериш" : "Доставка"}
              </label>
              <label className="inline-flex items-center gap-2">
                <Checkbox checked={pickupAvailable} onCheckedChange={(value) => setPickupAvailable(Boolean(value))} />
                {isUz ? "Ўз олиб кетиш" : "Самовывоз"}
              </label>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">
                {isUz ? "Товар категориялари" : "Категории товаров"} <span className="text-rose-600">*</span>
              </p>
              <Input
                value={categoriesRaw}
                onChange={(event) => setCategoriesRaw(event.target.value)}
                placeholder={isUz ? "Категориялар вергул билан: смартфонлар, маиший техника, мебель" : "Категории через запятую: смартфоны, бытовая техника, мебель"}
              />
              <p className="mt-1 text-xs text-muted-foreground">{isUz ? "Мисол: смартфонлар, ноутбуклар, аксессуарлар." : "Пример: смартфоны, ноутбуки, аксессуары."}</p>
              {errors.product_categories ? <p className="mt-1 text-xs text-rose-700">{errors.product_categories}</p> : null}
            </div>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={isUz ? "Модератор учун қўшимча маълумот (ихтиёрий)" : "Дополнительная информация для модератора (опционально)"} />

            <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              {isUz ? "Юлдузчали" : "Поля со"} <span className="text-rose-700">*</span> {isUz ? "майдонлар ариза юбориш учун мажбурий." : "обязательны для отправки заявки."}
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <label className="inline-flex items-start gap-2">
                <Checkbox checked={acceptsTerms} onCheckedChange={(value) => setAcceptsTerms(Boolean(value))} />
                <span>
                  {isUz ? "Маълумотлар тўғрилигини тасдиқлайман ва " : "Подтверждаю корректность данных и принимаю "}
                  <Link href="/terms" className="underline underline-offset-4">
                    {isUz ? "ҳамкорлик шартларини" : "условия партнёрства"}
                  </Link>{" "}
                  {isUz ? "ва " : "и "}
                  <Link href="/privacy" className="underline underline-offset-4">
                    {isUz ? "махфийлик сиёсатини" : "политику конфиденциальности"}
                  </Link>
                  .
                </span>
              </label>
              {errors.accepts_terms ? <p className="text-xs text-rose-700">{errors.accepts_terms}</p> : null}
            </div>

            {submitMessage ? (
              <p className={`text-sm ${submitMessage.kind === "error" ? "text-rose-700" : "text-emerald-700"}`}>{submitMessage.text}</p>
            ) : null}
            {submittedApplicationId ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <p className="inline-flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  {isUz ? "Ариза қабул қилинди" : "Заявка принята"}: {submittedApplicationId}
                </p>
                <p className="mt-1 text-xs">{isUz ? "Ариза ID'сини сақланг. Статусни пастдаги email ва телефон орқали текшириш мумкин." : "Сохраните ID заявки. Проверить статус можно по email и телефону ниже в этом разделе."}</p>
              </div>
            ) : null}

            <Button onClick={() => void submit()} disabled={createApplication.isPending}>
              {createApplication.isPending ? (isUz ? "Юборилмоқда..." : "Отправка...") : (isUz ? "Ариза юбориш" : "Отправить заявку")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isUz ? "Ариза ҳолати" : "Статус заявки"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => setLookup({ email: contactEmail.trim().toLowerCase(), phone: contactPhone.trim() })}
                disabled={!contactEmail.trim() || !contactPhone.trim()}
              >
                {isUz ? "Статусни янгилаш" : "Обновить статус"}
              </Button>
            </div>

            {statusQuery.data ? (
              <div className="space-y-1 rounded-lg border border-border p-3">
                <p>{isUz ? "Ҳолат" : "Статус"}: {statusLabel[statusQuery.data.status] ?? statusQuery.data.status}</p>
                <p>{isUz ? "Тайёрлаш" : "Подготовка"}: {statusQuery.data.provisioning_status}</p>
                {statusQuery.data.review_note ? <p>{isUz ? "Изоҳ" : "Комментарий"}: {statusQuery.data.review_note}</p> : null}
                {statusQuery.data.seller_login_url && statusQuery.data.seller_panel_url ? (
                  <a
                    href={statusQuery.data.seller_login_url}
                    className="inline-flex rounded-md border border-emerald-300 px-3 py-1 text-emerald-800"
                  >
                    {isUz ? "Сотувчи кабинетини очиш" : "Открыть кабинет продавца"}
                  </a>
                ) : (
                  <p className="text-muted-foreground">{isUz ? "Сотувчи кабинетига кириш тасдиқ ва тайёрлаш тугагандан кейин очилади." : "Доступ в кабинет продавца появится после одобрения и завершения подготовки."}</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
