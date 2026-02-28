"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePatchSellerProductStock, useSellerInventoryLog, useSellerProducts } from "@/features/seller/use-seller";

export default function SellerInventoryPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  const productsQuery = useSellerProducts({ q: query, limit: 100, offset: 0 });
  const stockMutation = usePatchSellerProductStock();

  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  const allItems = productsQuery.data ?? [];
  const items =
    mode === "low"
      ? allItems.filter(
          (item) =>
            item.stock_alert_threshold !== null &&
            item.stock_alert_threshold !== undefined &&
            item.stock_quantity <= item.stock_alert_threshold,
        )
      : allItems;

  useEffect(() => {
    if (!items.length) {
      setSelectedProductId("");
      return;
    }
    const first = items[0];
    if (!first) return;
    if (!selectedProductId || !items.some((item) => item.id === selectedProductId)) {
      setSelectedProductId(first.id);
      setQuantity(String(first.stock_quantity ?? 0));
    }
  }, [items, selectedProductId]);

  const selected = items.find((item) => item.id === selectedProductId) ?? null;
  const logQuery = useSellerInventoryLog(selectedProductId || undefined, { limit: 20, offset: 0 });

  const applyStock = async () => {
    if (!selectedProductId) return;
    setMessage("");
    const nextQuantity = Number(quantity);
    if (Number.isNaN(nextQuantity) || nextQuantity < 0) {
      setMessage("Остаток должен быть числом не меньше 0.");
      return;
    }
    try {
      const result = await stockMutation.mutateAsync({
        productId: selectedProductId,
        quantity: nextQuantity,
        comment: comment.trim() || undefined,
      });
      const deltaLabel = result.delta > 0 ? `+${result.delta}` : String(result.delta);
      setMessage(`Остаток обновлен: ${result.quantity} (delta ${deltaLabel}).`);
      setComment("");
    } catch {
      setMessage("Не удалось обновить остаток.");
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Остатки</h2>
        <p className="text-sm text-muted-foreground">Быстро обновляйте склад и отслеживайте историю изменений.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Фильтры и выбор товара</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию или SKU" />
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger>
              <SelectValue placeholder="Режим" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все товары</SelectItem>
              <SelectItem value="low">Только низкий остаток</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={selectedProductId}
            onValueChange={(value) => {
              setSelectedProductId(value);
              const current = items.find((item) => item.id === value);
              if (current) setQuantity(String(current.stock_quantity ?? 0));
            }}
          >
            <SelectTrigger className="sm:col-span-2">
              <SelectValue placeholder="Выберите товар" />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title} ({item.stock_quantity})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Быстрое обновление остатка</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input
            className="w-[220px]"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="numeric"
            placeholder="Новый остаток"
            disabled={!selected}
          />
          <Input
            className="w-[360px]"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Комментарий (опционально)"
            disabled={!selected}
          />
          <Button disabled={!selected || stockMutation.isPending} onClick={() => void applyStock()}>
            Обновить
          </Button>
          {message ? <p className="basis-full text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Список товаров</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Товар</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Остаток</TableHead>
                <TableHead>Порог</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Выбрать</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const lowStock =
                  item.stock_alert_threshold !== null &&
                  item.stock_alert_threshold !== undefined &&
                  item.stock_quantity <= item.stock_alert_threshold;
                return (
                  <TableRow key={item.id} className={selectedProductId === item.id ? "bg-secondary/40" : ""}>
                    <TableCell>{item.title}</TableCell>
                    <TableCell>{item.sku ?? "-"}</TableCell>
                    <TableCell>{item.stock_quantity}</TableCell>
                    <TableCell>{item.stock_alert_threshold ?? "-"}</TableCell>
                    <TableCell>
                      {lowStock ? (
                        <Badge className="border-rose-300 bg-rose-50 text-rose-700">Низкий остаток</Badge>
                      ) : (
                        <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700">Ок</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSelectedProductId(item.id);
                          setQuantity(String(item.stock_quantity ?? 0));
                        }}
                      >
                        Выбрать
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!items.length ? (
                <TableRow>
                  <td colSpan={6} className="px-4 py-3 text-center text-sm text-muted-foreground">
                    Подходящие товары не найдены.
                  </td>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">История изменений</CardTitle>
        </CardHeader>
        <CardContent>
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
              {(logQuery.data?.items ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.created_at}</TableCell>
                  <TableCell>{item.action}</TableCell>
                  <TableCell>{item.quantity_before}</TableCell>
                  <TableCell>{item.quantity_after}</TableCell>
                  <TableCell>{item.delta > 0 ? `+${item.delta}` : item.delta}</TableCell>
                  <TableCell>{item.comment ?? "-"}</TableCell>
                </TableRow>
              ))}
              {!logQuery.data?.items?.length ? (
                <TableRow>
                  <td colSpan={6} className="px-4 py-3 text-center text-sm text-muted-foreground">
                    История по выбранному товару пока пустая.
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
