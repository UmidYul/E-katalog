"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSellerProduct } from "@/features/seller/use-seller";

type FormState = {
  title: string;
  description: string;
  price: string;
  old_price: string;
  sku: string;
  barcode: string;
  stock_quantity: string;
  stock_alert_threshold: string;
  images_raw: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const initialState: FormState = {
  title: "",
  description: "",
  price: "",
  old_price: "",
  sku: "",
  barcode: "",
  stock_quantity: "0",
  stock_alert_threshold: "",
  images_raw: "",
};

export default function SellerProductCreatePage() {
  const router = useRouter();
  const createMutation = useCreateSellerProduct();
  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitMessage, setSubmitMessage] = useState<string>("");

  const images = useMemo(
    () =>
      form.images_raw
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((url) => ({ url })),
    [form.images_raw],
  );

  const validate = (): boolean => {
    const nextErrors: FormErrors = {};
    const title = form.title.trim();
    const price = Number(form.price);
    const oldPrice = form.old_price.trim() ? Number(form.old_price) : null;
    const stock = Number(form.stock_quantity);
    const stockThreshold = form.stock_alert_threshold.trim() ? Number(form.stock_alert_threshold) : null;

    if (!title || title.length < 2) nextErrors.title = "Введите название (минимум 2 символа).";
    if (!form.price.trim() || Number.isNaN(price) || price < 0) nextErrors.price = "Цена должна быть числом не меньше 0.";
    if (oldPrice !== null && (Number.isNaN(oldPrice) || oldPrice < 0)) nextErrors.old_price = "Старая цена должна быть числом не меньше 0.";
    if (Number.isNaN(stock) || stock < 0) nextErrors.stock_quantity = "Остаток должен быть числом не меньше 0.";
    if (stockThreshold !== null && (Number.isNaN(stockThreshold) || stockThreshold < 0)) {
      nextErrors.stock_alert_threshold = "Порог остатка должен быть числом не меньше 0.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submit = async (publish: boolean) => {
    setSubmitMessage("");
    if (!validate()) return;
    try {
      const created = await createMutation.mutateAsync({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        price: Number(form.price),
        old_price: form.old_price.trim() ? Number(form.old_price) : undefined,
        sku: form.sku.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        stock_quantity: Math.max(0, Number(form.stock_quantity)),
        stock_alert_threshold: form.stock_alert_threshold.trim() ? Math.max(0, Number(form.stock_alert_threshold)) : undefined,
        images,
        publish,
      });
      router.replace(`/dashboard/seller/products/${created.id}`);
    } catch {
      setSubmitMessage("Не удалось создать товар. Проверьте поля и попробуйте снова.");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Новый товар</h2>
          <p className="text-sm text-muted-foreground">Заполните карточку и сохраните как черновик или отправьте на модерацию.</p>
        </div>
        <Link href="/dashboard/seller/products">
          <Button variant="secondary">К списку товаров</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Основная информация</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Название товара"
            />
            {errors.title ? <p className="mt-1 text-xs text-rose-700">{errors.title}</p> : null}
          </div>
          <Input
            value={form.price}
            onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
            placeholder="Цена, UZS"
            inputMode="decimal"
          />
          <Input
            value={form.old_price}
            onChange={(event) => setForm((prev) => ({ ...prev, old_price: event.target.value }))}
            placeholder="Старая цена (опционально)"
            inputMode="decimal"
          />
          {errors.price ? <p className="text-xs text-rose-700">{errors.price}</p> : null}
          {errors.old_price ? <p className="text-xs text-rose-700">{errors.old_price}</p> : null}

          <Input value={form.sku} onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))} placeholder="SKU" />
          <Input value={form.barcode} onChange={(event) => setForm((prev) => ({ ...prev, barcode: event.target.value }))} placeholder="Штрихкод" />
          <Input
            value={form.stock_quantity}
            onChange={(event) => setForm((prev) => ({ ...prev, stock_quantity: event.target.value }))}
            placeholder="Остаток"
            inputMode="numeric"
          />
          <Input
            value={form.stock_alert_threshold}
            onChange={(event) => setForm((prev) => ({ ...prev, stock_alert_threshold: event.target.value }))}
            placeholder="Порог низкого остатка"
            inputMode="numeric"
          />
          {errors.stock_quantity ? <p className="text-xs text-rose-700">{errors.stock_quantity}</p> : null}
          {errors.stock_alert_threshold ? <p className="text-xs text-rose-700">{errors.stock_alert_threshold}</p> : null}

          <div className="sm:col-span-2">
            <Textarea
              rows={4}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Описание"
            />
          </div>
          <div className="sm:col-span-2">
            <Textarea
              rows={4}
              value={form.images_raw}
              onChange={(event) => setForm((prev) => ({ ...prev, images_raw: event.target.value }))}
              placeholder="URL изображений (по одному в строке или через запятую)"
            />
            <p className="mt-1 text-xs text-muted-foreground">Изображений: {images.length}</p>
          </div>
        </CardContent>
      </Card>

      {submitMessage ? <p className="text-sm text-rose-700">{submitMessage}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={createMutation.isPending} onClick={() => void submit(false)}>
          Сохранить как черновик
        </Button>
        <Button variant="secondary" disabled={createMutation.isPending} onClick={() => void submit(true)}>
          Отправить на модерацию
        </Button>
      </div>
    </section>
  );
}
