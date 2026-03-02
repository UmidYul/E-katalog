"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { SectionHeading } from "@/components/common/section-heading";
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
      <div className="container min-h-screen space-y-12 py-16">
        <header className="space-y-4">
          <SectionHeading title="Сравнение" description="Здесь вы сможете сопоставить характеристики выбранных товаров." />
        </header>

        <section className="flex flex-col items-center justify-center rounded-[3rem] border border-dashed border-border/60 bg-secondary/10 p-20 text-center">
          <EmptyState
            title="Список сравнения пуст"
            message="Добавляйте товары из каталога, чтобы увидеть детальную разницу в характеристиках."
          />
          <Link href="/catalog" className="mt-8">
            <Button className="h-14 rounded-2xl px-10 text-base font-bold shadow-xl shadow-primary/20">В каталог товаров</Button>
          </Link>
        </section>

        {history.length ? (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">Недавние сравнения</h2>
              <Button variant="ghost" size="sm" onClick={clearHistory} className="text-xs font-bold text-muted-foreground hover:text-destructive">
                Очистить историю
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {history.slice(0, 6).map((entry) => (
                <div key={entry.id} className="group relative overflow-hidden rounded-[2rem] border border-border/50 bg-card p-6 shadow-soft transition-all hover:shadow-xl hover:-translate-y-1">
                  <div className="space-y-4">
                    <p className="line-clamp-2 text-sm font-bold leading-tight">
                      {entry.items.map((item) => item.title).join(" vs ")}
                    </p>
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span>{entry.items.length} товара</span>
                      <span>{formatDateTime(entry.createdAt).split(',')[0]}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => restoreSnapshot(entry.id)}
                    className="mt-6 w-full rounded-xl bg-secondary/50 font-bold transition-all group-hover:bg-primary group-hover:text-white"
                  >
                    Восстановить
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  if (compareItems.length === 1) {
    const onlyItem = compareItems[0];
    if (!onlyItem) return null;

    return (
      <div className="container min-h-screen space-y-12 py-16">
        <header className="space-y-4">
          <SectionHeading title="Сравнение" description="Для сопоставления характеристик нужно выбрать минимум два товара." />
        </header>

        <section className="rounded-[3rem] border border-border/50 bg-card p-12 shadow-2xl">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-3xl font-black leading-tight">Одного товара недостаточно для полноценного сравнения</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Добавьте еще один товар из той же категории, и мы автоматически построим детальную матрицу характеристик с подстветкой отличий.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <Link href="/catalog">
                  <Button className="h-14 rounded-2xl px-10 text-base font-bold shadow-xl shadow-primary/20">Найти еще один</Button>
                </Link>
                <Button variant="outline" className="h-14 rounded-2xl border-2 px-10 font-bold" onClick={clear}>Очистить список</Button>
              </div>
            </div>
            <div className="relative aspect-video overflow-hidden rounded-[2rem] border border-border/50 bg-secondary/20 p-8 shadow-inner">
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div className="relative h-40 w-40 overflow-hidden rounded-2xl bg-white p-4 shadow-lg">
                  {/* Simplified Image display if available */}
                  <p className="text-[10px] font-black uppercase text-muted-foreground">Выбран сейчас</p>
                  <p className="mt-4 line-clamp-2 text-sm font-bold">{onlyItem.title}</p>
                </div>
                <div className="h-1 w-20 rounded-full bg-border/40" />
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-primary text-2xl font-black">
                  +
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (compareQuery.error) {
    return (
      <div className="container py-16">
        <ErrorState title="Ошибка загрузки сравнения" message="Нам не удалось получить детальные характеристики выбранных товаров." />
      </div>
    );
  }

  const columns = compareQuery.data?.items ?? [];

  return (
    <div className="container min-h-screen space-y-12 py-12">
      <header className="grid gap-8 lg:grid-cols-2 lg:items-end">
        <div className="space-y-4">
          <Breadcrumbs items={[{ href: "/", label: "Главная" }, { href: "/compare", label: "Сравнение" }]} />
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-4xl font-[900] tracking-tighter">Сравнение</h1>
            <Badge className="bg-primary/10 text-primary border-primary/20 px-3 font-black">{compareItems.length} товаров</Badge>
          </div>
          {categoryScope && (
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
              Категория: <span className="text-foreground">{formatCategory(categoryScope)}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            variant={onlyDiff ? "default" : "outline"}
            className="rounded-xl font-bold transition-all"
            onClick={() => setOnlyDiff((prev) => !prev)}
          >
            {onlyDiff ? "✨ Показаны отличия" : "Показать отличия"}
          </Button>
          <Button
            variant="outline"
            className="rounded-xl font-bold"
            onClick={onCreateShareLink}
            disabled={createShare.isPending}
          >
            {createShare.isPending ? "Создание..." : "Поделиться"}
          </Button>
          <Button
            variant="ghost"
            className="rounded-xl font-bold text-muted-foreground hover:text-destructive"
            onClick={clear}
          >
            Очистить всё
          </Button>
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-[1fr_minmax(0,1fr)] items-center">
        <div className="relative max-w-md">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60">🔍</span>
          <Input
            value={specQuery}
            onChange={(event) => setSpecQuery(event.target.value)}
            placeholder="Быстрый поиск по параметру (RAM, Экран, Вес...)"
            className="h-12 rounded-2xl border-none bg-secondary/50 pl-12 focus:bg-background focus:ring-primary/20 transition-all font-medium"
          />
        </div>
        <div className="flex justify-end items-center gap-6 text-xs font-bold text-muted-foreground uppercase tracking-wider">
          <span>Строк: <span className="text-foreground">{rows.length}</span></span>
          <span className="h-4 w-px bg-border/60" />
          <span>Отличий: <span className="text-primary">{diffRowsCount}</span></span>
        </div>
      </section>

      <div className="rounded-[2.5rem] border border-border/50 bg-card overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          {compareQuery.isLoading ? (
            <div className="p-20 text-center animate-pulse">
              <p className="text-xl font-black text-muted-foreground">Формируем матрицу сравнения...</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border/50 bg-secondary/10">
                  <th className="sticky left-0 z-30 min-w-[240px] bg-secondary/[0.05] backdrop-blur-md px-8 py-10 text-left">
                    <div className="space-y-1">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/60">Параметр</p>
                      <p className="text-lg font-black italic">Spec Matrix</p>
                    </div>
                  </th>
                  {columns.map((item) => {
                    const local = productMetaById.get(item.id);
                    const title = local?.title || item.normalized_title;
                    const slug = local?.slug || `${item.id}-${slugify(item.normalized_title)}`;
                    const image = isImageUrl(item.main_image) ? item.main_image : null;
                    return (
                      <th key={item.id} className="min-w-[280px] p-8 text-left">
                        <div className="space-y-6">
                          <div className="group relative aspect-square w-32 overflow-hidden rounded-2xl border border-border/50 bg-background p-4 shadow-sm transition-all hover:shadow-xl hover:-translate-y-1">
                            <Link href={`/product/${slug}`} className="block h-full w-full">
                              {image ? (
                                <Image src={image} alt={title} fill className="object-contain p-2 transition-transform group-hover:scale-110" sizes="128px" />
                              ) : (
                                <div className="flex h-full items-center justify-center bg-secondary/20 text-[10px] font-black uppercase text-muted-foreground/40">No Image</div>
                              )}
                            </Link>
                            <button
                              onClick={() => remove(item.id)}
                              className="absolute -right-2 -top-2 h-8 w-8 rounded-full bg-destructive text-white opacity-0 shadow-lg transition-all group-hover:right-2 group-hover:top-2 group-hover:opacity-100"
                            >
                              ×
                            </button>
                          </div>
                          <div className="space-y-1">
                            <Link href={`/product/${slug}`} className="line-clamp-2 block text-sm font-black leading-tight hover:text-primary transition-colors">
                              {title}
                            </Link>
                            <p className="text-xs font-bold text-muted-foreground opacity-60">ID: {item.id.slice(0, 8)}</p>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="p-20 text-center text-muted-foreground font-bold">
                      Отличий не найдено или ничего не соответствует запросу.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, rowIndex) => (
                    <tr key={row.key} className={cn(
                      "group border-b border-border/40 transition-colors hover:bg-secondary/10",
                      rowIndex % 2 === 1 && "bg-secondary/[0.03]"
                    )}>
                      <td className="sticky left-0 z-10 bg-card group-hover:bg-secondary/5 font-bold px-8 py-5 text-sm border-r border-border/40">
                        <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                          {row.label}
                        </span>
                      </td>
                      {row.values.map((value, index) => (
                        <td
                          key={`${row.key}:${columns[index]?.id ?? index}`}
                          className={cn(
                            "px-8 py-5 text-sm transition-all",
                            row.bestCellIndexes.has(index)
                              ? "bg-emerald-500/[0.03] font-black text-emerald-600 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]"
                              : "text-muted-foreground font-medium"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {row.bestCellIndexes.has(index) && <span className="text-[10px]">🏆</span>}
                            {renderCellValue(row.key, value)}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {shareStatus && (
        <div className="flex items-center justify-center">
          <div className="rounded-2xl bg-secondary/50 px-6 py-3 text-xs font-bold text-muted-foreground border border-border/50">
            {shareStatus}
          </div>
        </div>
      )}

      {history.length ? (
        <section className="space-y-8 pt-12">
          <header className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-black italic tracking-tight">Recent Archives</h2>
              <p className="text-xs font-bold text-muted-foreground uppercase">Ваши предыдущие сравнения</p>
            </div>
            <Button variant="ghost" size="sm" onClick={clearHistory} className="rounded-xl text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              Purge History
            </Button>
          </header>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {history.slice(0, 8).map((entry) => (
              <button
                key={entry.id}
                onClick={() => restoreSnapshot(entry.id)}
                className="flex flex-col items-start gap-3 rounded-[2rem] border border-border/50 bg-card p-6 text-left shadow-soft transition-all hover:shadow-xl hover:-translate-y-1 group"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/80 text-muted-foreground group-hover:bg-primary group-hover:text-white transition-colors">
                  🔄
                </div>
                <div className="space-y-1">
                  <p className="line-clamp-1 text-sm font-black leading-tight">
                    {entry.items.map((item) => item.title.split(' ')[0]).join(", ")}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                    {entry.items.length} Units • {formatDateTime(entry.createdAt).split(',')[0]}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
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
