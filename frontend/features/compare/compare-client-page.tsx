"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompareProducts, useCreateCompareShare, useResolveCompareShare } from "@/features/compare/use-compare";
import { catalogApi } from "@/lib/api/openapi-client";
import { formatColorValue } from "@/lib/utils/color-name";
import { cn } from "@/lib/utils/cn";
import { formatSpecLabel, normalizeSpecsMap } from "@/lib/utils/specs";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";

const normalizeValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "string") return value.trim() || "-";
  return JSON.stringify(value);
};

const hasDiffInRow = (values: unknown[]) => {
  const unique = new Set(values.map((value) => normalizeValue(value)));
  return unique.size > 1;
};

const parseNumeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(",", ".");
  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const lowerIsBetterHints = ["price", "cost", "weight", "thickness", "depth", "height", "width", "length", "latency", "delay"];

const scoreNetworkStandard = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  let score = 0;
  if (/\b2g\b/i.test(lower)) score += 2;
  if (/\b3g\b/i.test(lower)) score += 3;
  if (/\b4g\b/i.test(lower)) score += 4;
  if (/\blte\b/i.test(lower)) score += 0.5;
  if (/\b5g\b/i.test(lower)) score += 5;
  if (/\b6g\b/i.test(lower)) score += 6;
  return score > 0 ? score : null;
};

const scoreWifiStandard = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();

  const tokenRank: Record<string, number> = {
    a: 1,
    b: 1,
    g: 2,
    n: 3,
    ac: 5,
    ax: 6,
    be: 7
  };

  const uniqueRanks = new Set<number>();
  for (const match of lower.matchAll(/802\.11\s*([a-z0-9/\s,.-]+)/gi)) {
    const chunk = String(match[1] ?? "").toLowerCase();
    for (const rawToken of chunk.split(/[/,\s.-]+/g)) {
      const token = rawToken.trim().toLowerCase();
      if (tokenRank[token] !== undefined) uniqueRanks.add(tokenRank[token] ?? 0);
    }
  }
  for (const match of lower.matchAll(/802\.11([a-z]{1,2})/gi)) {
    const token = String(match[1] ?? "").toLowerCase();
    if (tokenRank[token] !== undefined) uniqueRanks.add(tokenRank[token] ?? 0);
  }

  const wifiGenMatch = lower.match(/wi[\s-]?fi\s*([4-7])/i);
  const wifiGen = wifiGenMatch ? Number(wifiGenMatch[1]) : null;

  const maxRank = Math.max(wifiGen ?? 0, ...Array.from(uniqueRanks));
  if (maxRank <= 0) return null;
  return maxRank * 10 + uniqueRanks.size;
};

const parseComparableScore = (specKey: string, value: unknown): number | null => {
  if (specKey === "network_standard" || specKey === "network") return scoreNetworkStandard(value);
  if (specKey === "wifi_standard") return scoreWifiStandard(value);
  if (specKey === "sim_count" || specKey === "sim_type" || specKey === "device_type") return null;
  return parseNumeric(value);
};

const isLowerBetter = (specKey: string) => {
  const key = specKey.toLowerCase();
  return lowerIsBetterHints.some((hint) => key.includes(hint));
};

const getBestCellIndexes = (specKey: string, values: unknown[]) => {
  if (specKey.includes("color")) return new Set<number>();

  const numericValues = values
    .map((value, index) => ({ index, value: parseComparableScore(specKey, value) }))
    .filter((item): item is { index: number; value: number } => item.value !== null);

  if (numericValues.length < 2) return new Set<number>();

  const spread = Math.max(...numericValues.map((item) => item.value)) - Math.min(...numericValues.map((item) => item.value));
  if (spread === 0) return new Set<number>();

  const target = isLowerBetter(specKey)
    ? Math.min(...numericValues.map((item) => item.value))
    : Math.max(...numericValues.map((item) => item.value));

  return new Set(numericValues.filter((item) => Math.abs(item.value - target) < 1e-9).map((item) => item.index));
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Неизвестно";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const formatCategory = (value?: string) => {
  if (!value) return undefined;
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const normalizeCategory = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
};

const rowPriorityOrder = ["price_min", "price_max", "store_count"];
const keySpecHints = [
  "price",
  "store_count",
  "display",
  "screen",
  "cpu",
  "chip",
  "ram",
  "storage",
  "battery",
  "camera",
  "network",
  "wifi",
  "bluetooth",
  "weight",
  "dimensions"
];

const formatInteger = (value: number) => Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const renderCellValue = (rowKey: string, value: unknown) => {
  if (rowKey === "price_min" || rowKey === "price_max") {
    const numeric = parseNumeric(value);
    if (numeric !== null) return `${formatInteger(numeric)} UZS`;
  }
  if (rowKey.includes("color") && typeof value === "string") return formatColorValue(value);
  return normalizeValue(value);
};

const isImageUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return /^https?:\/\//i.test(normalized);
};

export function CompareClientPage() {
  const searchParams = useSearchParams();
  const compareItems = useCompareStore((s) => s.items);
  const history = useCompareStore((s) => s.history);
  const remove = useCompareStore((s) => s.remove);
  const replace = useCompareStore((s) => s.replace);
  const clear = useCompareStore((s) => s.clear);
  const saveSnapshot = useCompareStore((s) => s.saveSnapshot);
  const restoreSnapshot = useCompareStore((s) => s.restoreSnapshot);
  const clearHistory = useCompareStore((s) => s.clearHistory);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [specQuery, setSpecQuery] = useState("");
  const [focusMode, setFocusMode] = useState<"all" | "key">("all");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null);
  const [lastShareExpiresAt, setLastShareExpiresAt] = useState<string | null>(null);
  const [appliedShareToken, setAppliedShareToken] = useState<string | null>(null);
  const productIds = useMemo(() => compareItems.map((item) => item.id), [compareItems]);
  const shareToken = useMemo(() => {
    const raw = searchParams.get("share");
    if (!raw) return null;
    const normalized = raw.trim();
    return normalized || null;
  }, [searchParams]);
  const compareQuery = useCompareProducts(productIds);
  const createShare = useCreateCompareShare();
  const sharedCompareQuery = useResolveCompareShare(shareToken);
  const productMetaById = useMemo(() => new Map(compareItems.map((item) => [item.id, item])), [compareItems]);
  const matrixMetaById = useMemo(() => new Map((compareQuery.data?.items ?? []).map((item) => [item.id, item])), [compareQuery.data?.items]);
  const categoryScope = useMemo(() => {
    for (const item of compareItems) {
      const category = normalizeCategory(item.category);
      if (category) return category;
    }
    return undefined;
  }, [compareItems]);

  useEffect(() => {
    if (!compareQuery.isSuccess || compareItems.length < 2) return;
    saveSnapshot(compareItems);
  }, [compareItems, compareQuery.isSuccess, saveSnapshot]);

  useEffect(() => {
    setAppliedShareToken(null);
  }, [shareToken]);

  useEffect(() => {
    if (!shareToken || !sharedCompareQuery.data || appliedShareToken === shareToken) return;
    let cancelled = false;
    const hydrateSharedCompare = async () => {
      const incomingIds = sharedCompareQuery.data.product_ids ?? [];
      const nextItems: Array<{ id: string; title: string; slug: string; category?: string }> = [];
      for (const id of incomingIds) {
        const local = compareItems.find((item) => item.id === id);
        if (local) {
          nextItems.push({ id: local.id, title: local.title, slug: local.slug, category: local.category });
          continue;
        }
        try {
          const product = await catalogApi.getProduct(id);
          nextItems.push({
            id,
            title: product.title || id,
            slug: `${id}-${slugify(product.title || id)}`,
            category: typeof product.category === "string" ? product.category : undefined
          });
        } catch {
          continue;
        }
      }
      if (cancelled) return;
      if (nextItems.length < 2) {
        setShareStatus("Не удалось восстановить сравнение по ссылке.");
        return;
      }
      replace(nextItems);
      setAppliedShareToken(shareToken);
      setShareStatus(`Сравнение загружено по общей ссылке до ${formatDateTime(sharedCompareQuery.data.expires_at)}.`);
    };
    void hydrateSharedCompare();
    return () => {
      cancelled = true;
    };
  }, [appliedShareToken, compareItems, replace, shareToken, sharedCompareQuery.data]);

  useEffect(() => {
    if (!shareToken || !sharedCompareQuery.isError) return;
    setShareStatus("Ссылка сравнения недействительна или устарела.");
  }, [shareToken, sharedCompareQuery.isError]);

  const rows = useMemo(() => {
    const items = compareQuery.data?.items ?? [];
    const normalizedItems = items.map((item) => normalizeSpecsMap({ ...(item.attributes ?? {}), ...(item.specs ?? {}) }));
    const keys = Array.from(new Set(normalizedItems.flatMap((specs) => Object.keys(specs)))).sort((a, b) => {
      const aPriority = rowPriorityOrder.indexOf(a);
      const bPriority = rowPriorityOrder.indexOf(b);
      if (aPriority !== -1 || bPriority !== -1) {
        if (aPriority === -1) return 1;
        if (bPriority === -1) return -1;
        return aPriority - bPriority;
      }
      return a.localeCompare(b);
    });

    const allRows = keys.map((key) => {
      const values = normalizedItems.map((specs) => specs[key]);
      return { key, label: formatSpecLabel(key), values, bestCellIndexes: getBestCellIndexes(key, values) };
    });

    const normalizedQuery = specQuery.trim().toLowerCase();

    return allRows.filter((row) => {
      if (onlyDiff && !hasDiffInRow(row.values)) return false;
      if (
        focusMode === "key" &&
        !keySpecHints.some((hint) => row.key.toLowerCase().includes(hint) || row.label.toLowerCase().includes(hint))
      ) {
        return false;
      }
      if (!normalizedQuery) return true;
      return row.key.toLowerCase().includes(normalizedQuery) || row.label.toLowerCase().includes(normalizedQuery);
    });
  }, [compareQuery.data?.items, focusMode, onlyDiff, specQuery]);

  const diffRowsCount = useMemo(() => rows.filter((row) => hasDiffInRow(row.values)).length, [rows]);

  const onCreateShareLink = async () => {
    if (productIds.length < 2) {
      setShareStatus("Для общей ссылки выберите минимум 2 товара.");
      return;
    }
    try {
      const response = await createShare.mutateAsync({ productIds, ttlDays: 30, source: "compare_page" });
      const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${response.share_path}` : response.share_path;
      setLastShareUrl(shareUrl);
      setLastShareExpiresAt(response.expires_at);
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ url: shareUrl, title: "Сравнение товаров" });
        setShareStatus("Ссылка сравнения отправлена через системный share.");
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareStatus("Ссылка сравнения скопирована в буфер.");
        return;
      }
      setShareStatus(`Ссылка сравнения готова до ${formatDateTime(response.expires_at)}.`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setShareStatus("Отправка ссылки отменена.");
        return;
      }
      setShareStatus("Не удалось создать ссылку сравнения.");
    }
  };

  if (compareItems.length === 0) {
    return (
      <div className="mx-auto max-w-7xl space-y-3 px-4 py-6">
        {shareToken ? (
          <p className="text-sm text-muted-foreground">
            {sharedCompareQuery.isPending ? "Загружаем сравнение по ссылке..." : shareStatus ?? "Ожидаем данные сравнения..."}
          </p>
        ) : null}
        <EmptyState title="Сравнение пока пустое" message="Добавьте товары из каталога или карточки товара, чтобы начать сравнение." />
        <Link href="/catalog">
          <Button>Перейти в каталог</Button>
        </Link>
        {history.length ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Недавние сравнения</CardTitle>
              <Button variant="ghost" size="sm" onClick={clearHistory}>
                Очистить историю
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.slice(0, 6).map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div>
                    <p className="line-clamp-1 text-sm font-medium">{entry.items.map((item) => item.title).join(" vs ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)} | {entry.items.length} товаров
                      {entry.category ? ` | ${formatCategory(entry.category)}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                    Восстановить
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  if (compareItems.length === 1) {
    const onlyItem = compareItems[0];
    if (!onlyItem) return null;

    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Для сравнения нужно минимум 2 товара</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Сейчас выбран только один товар. Добавьте ещё один, чтобы увидеть полную матрицу сравнения.</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/product/${onlyItem.slug}`}>
                <Button variant="outline">Открыть выбранный товар</Button>
              </Link>
              <Link href="/catalog">
                <Button>Добавить ещё товар</Button>
              </Link>
              <Button variant="ghost" onClick={clear}>
                Очистить
              </Button>
            </div>
            {history.length ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">Недавние сравнения:</p>
                <div className="flex flex-wrap gap-2">
                  {history.slice(0, 4).map((entry) => (
                    <Button key={entry.id} size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                      Восстановить {entry.items.length}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (compareQuery.error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <ErrorState title="Не удалось построить сравнение" message="Попробуйте убрать недоступные товары и повторите." />
      </div>
    );
  }

  const columns = compareQuery.data?.items ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-extrabold">Сравнение</h1>
            <Badge>
              {compareItems.length}/{COMPARE_LIMIT} выбрано
            </Badge>
            {categoryScope ? <Badge className="bg-secondary/80">{formatCategory(categoryScope)}</Badge> : null}
            {compareQuery.isFetching ? <Badge className="bg-secondary/80">Обновляем...</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">Сравнение работает в рамках одной категории. Заголовки и первая колонка закреплены для удобного чтения.</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-1 text-success">
              <span className="h-2 w-2 rounded-full bg-success" /> Лучшее значение
            </span>
            <span>Подсветка лучшего значения рассчитывается по эвристике.</span>
          </div>
          {shareStatus ? <p className="text-xs text-primary">{shareStatus}</p> : null}
          {lastShareUrl ? (
            <p className="text-xs text-muted-foreground">
              Ссылка:{" "}
              <a href={lastShareUrl} className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">
                открыть
              </a>
              {lastShareExpiresAt ? ` (действует до ${formatDateTime(lastShareExpiresAt)})` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={onlyDiff ? "default" : "outline"} size="sm" onClick={() => setOnlyDiff((prev) => !prev)}>
            {onlyDiff ? "Показаны отличия" : "Показать только отличия"}
          </Button>
          <Button variant={focusMode === "key" ? "default" : "outline"} size="sm" onClick={() => setFocusMode((prev) => (prev === "all" ? "key" : "all"))}>
            {focusMode === "key" ? "Ключевые характеристики" : "Фокус: ключевые"}
          </Button>
          <Button variant="outline" size="sm" onClick={onCreateShareLink} disabled={createShare.isPending || productIds.length < 2}>
            {createShare.isPending ? "Готовим ссылку..." : "Поделиться"}
          </Button>
          <Button variant="ghost" size="sm" onClick={clear}>
            Очистить всё
          </Button>
          {history.length ? (
            <Button variant="ghost" size="sm" onClick={clearHistory}>
              Очистить историю
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(280px,420px)_1fr] md:items-center">
        <Input
          value={specQuery}
          onChange={(event) => setSpecQuery(event.target.value)}
          placeholder="Поиск по характеристикам: например, камера, ram, wifi"
          aria-label="Поиск характеристики в матрице сравнения"
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">
          Строк в матрице: {rows.length}, отличий: {diffRowsCount}.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {compareItems.map((item) => (
          <Card key={item.id}>
            <CardContent className="space-y-2 p-4">
              {(() => {
                const matrixItem = matrixMetaById.get(item.id);
                const image = isImageUrl(matrixItem?.main_image) ? matrixItem.main_image : null;
                if (!image) return null;
                return (
                  <Link href={`/product/${item.slug}`} className="block">
                    <div className="relative mb-2 aspect-square overflow-hidden rounded-lg border border-border bg-card">
                      <Image src={image} alt={item.title} fill className="object-contain p-2" sizes="(max-width: 1280px) 50vw, 25vw" />
                    </div>
                  </Link>
                );
              })()}
              <Link href={`/product/${item.slug}`} className="line-clamp-2 text-sm font-semibold text-primary hover:underline">
                {item.title}
              </Link>
              <div className="flex gap-2">
                <Link href={`/product/${item.slug}`}>
                  <Button size="sm" variant="outline">
                    Открыть
                  </Button>
                </Link>
                <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>
                  Убрать
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {compareQuery.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Загружаем матрицу сравнения...</div>
          ) : (
            <table className="min-w-[760px] w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="sticky left-0 top-0 z-30 min-w-56 bg-card px-4 py-3 text-left text-sm font-semibold">Характеристика</th>
                  {columns.map((item) => {
                    const local = productMetaById.get(item.id);
                    const title = local?.title || item.normalized_title;
                    const slug = local?.slug || `${item.id}-${slugify(item.normalized_title)}`;
                    const image = isImageUrl(item.main_image) ? item.main_image : null;
                    return (
                      <th key={item.id} className="sticky top-0 z-20 min-w-56 bg-card px-4 py-3 text-left text-sm font-semibold">
                        <div className="space-y-2">
                          {image ? (
                            <Link href={`/product/${slug}`} className="block">
                              <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-border bg-background">
                                <Image src={image} alt={title} fill className="object-contain p-1" sizes="96px" />
                              </div>
                            </Link>
                          ) : null}
                          <Link href={`/product/${slug}`} className="hover:text-primary">
                            {title}
                          </Link>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm text-muted-foreground">Отличий не найдено</td>
                    {columns.map((item) => (
                      <td key={item.id} className="px-4 py-3 text-sm text-muted-foreground">
                        -
                      </td>
                    ))}
                  </tr>
                ) : (
                  rows.map((row, rowIndex) => (
                    <tr key={row.key} className={cn("border-t border-border", rowIndex % 2 === 1 && "bg-secondary/15")}>
                      <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm font-medium">{row.label}</td>
                      {row.values.map((value, index) => (
                        <td
                          key={`${row.key}:${columns[index]?.id ?? index}`}
                          className={cn("px-4 py-3 text-sm text-muted-foreground", row.bestCellIndexes.has(index) && "bg-success/15 font-semibold text-success")}
                        >
                          {renderCellValue(row.key, value)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {history.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Недавние сравнения</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {history.slice(0, 6).map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="line-clamp-1 text-sm font-medium">{entry.items.map((item) => item.title).join(" vs ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)} | {entry.items.length} товаров
                    {entry.category ? ` | ${formatCategory(entry.category)}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                  Восстановить
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
