"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useArchiveSellerProduct, useSellerProducts } from "@/features/seller/use-seller";

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
  if (normalized === "archived") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-slate-300 bg-slate-50 text-slate-700";
};

export default function SellerProductsPage() {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const productsQuery = useSellerProducts({ status, q: query, limit: 100, offset: 0 });
  const archiveMutation = useArchiveSellerProduct();

  const items = productsQuery.data ?? [];
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(items.map((item) => item.id)));
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const archiveMany = async () => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await archiveMutation.mutateAsync(id);
    }
    setSelectedIds(new Set());
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Товары</h2>
          <p className="text-sm text-muted-foreground">Управляйте карточками товаров, статусами модерации и архивом.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/seller/products/new">
            <Button>Добавить товар</Button>
          </Link>
          <Badge className="border-slate-300 bg-slate-50 text-slate-700">Всего: {items.length}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Фильтры</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="draft">Черновик</SelectItem>
              <SelectItem value="pending_moderation">На модерации</SelectItem>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="rejected">Отклоненные</SelectItem>
              <SelectItem value="archived">Архив</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-md"
            placeholder="Поиск по названию или SKU"
          />
          <Button variant="secondary" disabled={!selectedIds.size || archiveMutation.isPending} onClick={() => void archiveMany()}>
            Архивировать выбранные ({selectedIds.size})
          </Button>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleAll(Boolean(checked))} />
            </TableHead>
            <TableHead>Товар</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Цена</TableHead>
            <TableHead>Остаток</TableHead>
            <TableHead>Обновлен</TableHead>
            <TableHead className="text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const lowStock = item.stock_alert_threshold !== null && item.stock_alert_threshold !== undefined && item.stock_quantity <= item.stock_alert_threshold;
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <Checkbox checked={selectedIds.has(item.id)} onCheckedChange={(checked) => toggleOne(item.id, Boolean(checked))} />
                </TableCell>
                <TableCell>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.sku || item.id}</p>
                </TableCell>
                <TableCell>
                  <Badge className={statusBadgeClass(item.status)}>{statusLabel[item.status] ?? item.status}</Badge>
                </TableCell>
                <TableCell>{Number(item.price ?? 0).toLocaleString()} UZS</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{item.stock_quantity}</span>
                    {lowStock ? <Badge className="border-rose-300 bg-rose-50 text-rose-700">Низкий</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{item.updated_at}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-2">
                    <Link href={`/dashboard/seller/products/${item.id}`}>
                      <Button variant="secondary" size="sm">
                        Открыть
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate(item.id)}>
                      В архив
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {!items.length ? (
            <TableRow>
              <td colSpan={7} className="px-4 py-4 text-center text-sm text-muted-foreground">
                Товары не найдены.
              </td>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </section>
  );
}
