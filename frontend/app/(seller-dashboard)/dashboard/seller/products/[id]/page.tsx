"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useArchiveSellerProduct,
  usePatchSellerProductStock,
  useSellerInventoryLog,
  useSellerProduct,
  useSellerProductStatusHistory,
  useUpdateSellerProduct,
} from "@/features/seller/use-seller";

type ProductFormState = {
  title: string;
  description: string;
  price: string;
  old_price: string;
  sku: string;
  barcode: string;
  stock_alert_threshold: string;
  images_raw: string;
};

const statusLabel: Record<string, string> = {
  draft: "Черновик",
  pending_moderation: "На модерации",
  active: "Активен",
  rejected: "Отклонен",
  archived: "В архиве",
};

const statusBadgeClass = (status: string) => {
  const normalized = String(status).toLowerCase();
  if (normalized === "active") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (normalized === "rejected") return "border-rose-300 bg-rose-50 text-rose-800";
  if (normalized === "pending_moderation") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
};

const defaultForm: ProductFormState = {
  title: "",
  description: "",
  price: "",
  old_price: "",
  sku: "",
  barcode: "",
  stock_alert_threshold: "",
  images_raw: "",
};

export default function SellerProductDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const productId = String(params?.id ?? "");
  const productQuery = useSellerProduct(productId);
  const inventoryQuery = useSellerInventoryLog(productId, { limit: 30, offset: 0 });
  const statusHistoryQuery = useSellerProductStatusHistory(productId, { limit: 30, offset: 0 });
  const updateMutation = useUpdateSellerProduct();
  const archiveMutation = useArchiveSellerProduct();
  const stockMutation = usePatchSellerProductStock();

  const [form, setForm] = useState<ProductFormState>(defaultForm);
  const [formError, setFormError] = useState<string>("");
  const [formSuccess, setFormSuccess] = useState<string>("");
  const [stockQuantity, setStockQuantity] = useState<string>("");
  const [stockComment, setStockComment] = useState<string>("");
  const [stockMessage, setStockMessage] = useState<string>("");

  useEffect(() => {
    const item = productQuery.data;
    if (!item) return;
    setForm({
      title: item.title,
      description: item.description ?? "",
      price: String(item.price ?? ""),
      old_price: item.old_price !== null && item.old_price !== undefined ? String(item.old_price) : "",
      sku: item.sku ?? "",
      barcode: item.barcode ?? "",
      stock_alert_threshold:
        item.stock_alert_threshold !== null && item.stock_alert_threshold !== undefined ? String(item.stock_alert_threshold) : "",
      images_raw: item.images.map((entry) => String(entry?.url ?? "")).filter(Boolean).join("\n"),
    });
    setStockQuantity(String(item.stock_quantity ?? 0));
  }, [productQuery.data]);

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

  const save = async (targetStatus: "draft" | "pending_moderation") => {
    if (!productId) return;
    setFormError("");
    setFormSuccess("");
    if (!form.title.trim() || form.title.trim().length < 2) {
      setFormError("Введите название товара (минимум 2 символа).");
      return;
    }
    if (!form.price.trim() || Number.isNaN(Number(form.price)) || Number(form.price) < 0) {
      setFormError("Цена должна быть числом не меньше 0.");
      return;
    }

    try {
      const updated = await updateMutation.mutateAsync({
        productId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        old_price: form.old_price.trim() ? Number(form.old_price) : null,
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        stock_alert_threshold: form.stock_alert_threshold.trim() ? Number(form.stock_alert_threshold) : null,
        images,
        status: targetStatus,
      });
      if (updated.status === "pending_moderation" && productQuery.data?.status === "active") {
        setFormSuccess("Изменения сохранены. Товар отправлен на повторную модерацию.");
      } else {
        setFormSuccess("Изменения сохранены.");
      }
    } catch {
      setFormError("Не удалось сохранить товар.");
    }
  };

  const archive = async () => {
    if (!productId) return;
    try {
      await archiveMutation.mutateAsync(productId);
      router.replace("/dashboard/seller/products");
    } catch {
      setFormError("Не удалось отправить товар в архив.");
    }
  };

  const updateStock = async () => {
    if (!productId) return;
    setStockMessage("");
    const quantity = Number(stockQuantity);
    if (Number.isNaN(quantity) || quantity < 0) {
      setStockMessage("Остаток должен быть числом не меньше 0.");
      return;
    }
    try {
      const result = await stockMutation.mutateAsync({ productId, quantity, comment: stockComment.trim() || undefined });
      const direction = result.delta > 0 ? `+${result.delta}` : String(result.delta);
      setStockMessage(`Остаток обновлен: ${result.quantity} (delta ${direction}).`);
      setStockComment("");
    } catch {
      setStockMessage("Не удалось обновить остаток.");
    }
  };

  if (productQuery.isLoading) {
    return <div className="py-6 text-sm text-muted-foreground">Загрузка товара...</div>;
  }

  if (productQuery.isError || !productQuery.data) {
    return (
      <div className="space-y-3 py-6">
        <p className="text-sm text-rose-700">Товар не найден или недоступен.</p>
        <Link href="/dashboard/seller/products">
          <Button variant="secondary">Назад к списку</Button>
        </Link>
      </div>
    );
  }

  const product = productQuery.data;
  const lowStock =
    product.stock_alert_threshold !== null &&
    product.stock_alert_threshold !== undefined &&
    product.stock_quantity <= product.stock_alert_threshold;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{product.title}</h2>
          <div className="mt-1 flex items-center gap-2">
            <Badge className={statusBadgeClass(product.status)}>{statusLabel[product.status] ?? product.status}</Badge>
            {lowStock ? <Badge className="border-rose-300 bg-rose-50 text-rose-700">Низкий остаток</Badge> : null}
          </div>
        </div>
        <Link href="/dashboard/seller/products">
          <Button variant="secondary">К списку товаров</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Карточка товара</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Название товара"
            />
          </div>
          <Input
            value={form.price}
            onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
            inputMode="decimal"
            placeholder="Цена, UZS"
          />
          <Input
            value={form.old_price}
            onChange={(event) => setForm((prev) => ({ ...prev, old_price: event.target.value }))}
            inputMode="decimal"
            placeholder="Старая цена"
          />
          <Input value={form.sku} onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))} placeholder="SKU" />
          <Input value={form.barcode} onChange={(event) => setForm((prev) => ({ ...prev, barcode: event.target.value }))} placeholder="Штрихкод" />
          <Input
            value={form.stock_alert_threshold}
            onChange={(event) => setForm((prev) => ({ ...prev, stock_alert_threshold: event.target.value }))}
            inputMode="numeric"
            placeholder="Порог низкого остатка"
          />
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
              placeholder="URL изображений (по одному на строку или через запятую)"
            />
            <p className="mt-1 text-xs text-muted-foreground">Изображений: {images.length}</p>
          </div>

          {product.moderation_comment ? (
            <div className="sm:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Комментарий модератора: {product.moderation_comment}
            </div>
          ) : null}
          {formError ? <p className="sm:col-span-2 text-sm text-rose-700">{formError}</p> : null}
          {formSuccess ? <p className="sm:col-span-2 text-sm text-emerald-700">{formSuccess}</p> : null}

          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <Button disabled={updateMutation.isPending} onClick={() => void save("draft")}>
              Сохранить как черновик
            </Button>
            <Button variant="secondary" disabled={updateMutation.isPending} onClick={() => void save("pending_moderation")}>
              Отправить на модерацию
            </Button>
            <Button variant="outline" disabled={archiveMutation.isPending} onClick={() => void archive()}>
              Снять с публикации
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">История модерации</CardTitle>
        </CardHeader>
        <CardContent>
          {statusHistoryQuery.isLoading ? <p className="text-sm text-muted-foreground">Загрузка истории...</p> : null}
          {!statusHistoryQuery.isLoading && statusHistoryQuery.data?.items?.length ? (
            <ol className="relative ml-3 border-l border-slate-200 pl-5">
              {statusHistoryQuery.data.items.map((event) => {
                const fromLabel = event.from_status ? statusLabel[event.from_status] ?? event.from_status : "—";
                const toLabel = statusLabel[event.to_status] ?? event.to_status;
                return (
                  <li key={event.id} className="relative pb-5 last:pb-0">
                    <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-400" />
                    <p className="text-xs text-muted-foreground">{event.created_at}</p>
                    <p className="text-sm font-medium">
                      {fromLabel}
                      {" -> "}
                      {toLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.reason_label}. Кто изменил: {event.actor_label}.
                    </p>
                    {event.comment ? <p className="mt-1 text-sm text-slate-700">Комментарий: {event.comment}</p> : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {!statusHistoryQuery.isLoading && !statusHistoryQuery.data?.items?.length ? (
            <p className="text-sm text-muted-foreground">История модерации пока не накоплена.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Остаток</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-[220px]"
              value={stockQuantity}
              onChange={(event) => setStockQuantity(event.target.value)}
              inputMode="numeric"
              placeholder="Новый остаток"
            />
            <Input
              className="w-[360px]"
              value={stockComment}
              onChange={(event) => setStockComment(event.target.value)}
              placeholder="Комментарий к изменению (опционально)"
            />
            <Button disabled={stockMutation.isPending} onClick={() => void updateStock()}>
              Обновить остаток
            </Button>
          </div>
          {stockMessage ? <p className="text-sm text-muted-foreground">{stockMessage}</p> : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Когда</TableHead>
                <TableHead>Действие</TableHead>
                <TableHead>Было</TableHead>
                <TableHead>Стало</TableHead>
                <TableHead>Delta</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(inventoryQuery.data?.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.created_at}</TableCell>
                  <TableCell>{item.action}</TableCell>
                  <TableCell>{item.quantity_before}</TableCell>
                  <TableCell>{item.quantity_after}</TableCell>
                  <TableCell>{item.delta > 0 ? `+${item.delta}` : item.delta}</TableCell>
                  <TableCell>{item.comment ?? "-"}</TableCell>
                </TableRow>
              ))}
              {!inventoryQuery.data?.items?.length ? (
                <TableRow>
                  <td colSpan={6} className="px-4 py-3 text-center text-sm text-muted-foreground">
                    История изменений остатков пока пустая.
                  </td>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
