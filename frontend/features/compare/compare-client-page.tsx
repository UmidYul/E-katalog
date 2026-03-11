"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/components/common/locale-provider";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompareProducts, useCreateCompareShare, useResolveCompareShare } from "@/features/compare/use-compare";
import type { Locale } from "@/lib/i18n/types";
import { catalogApi } from "@/lib/api/openapi-client";
import { formatColorValue } from "@/lib/utils/color-name";
import { cn } from "@/lib/utils/cn";
import { formatDateTime as formatLocalizedDateTime, formatNumber } from "@/lib/utils/format";
import { formatSpecLabel, normalizeSpecsMap } from "@/lib/utils/specs";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";

const normalizeValue = (value: unknown, locale: Locale): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? (locale === "uz-Cyrl-UZ" ? "Ҳа" : "Да") : (locale === "uz-Cyrl-UZ" ? "Йўқ" : "Нет");
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "string") return value.trim() || "-";
  return JSON.stringify(value);
};

const hasDiffInRow = (values: unknown[], locale: Locale) => {
  const unique = new Set(values.map((value) => normalizeValue(value, locale)));
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

const formatDateTime = (value: string, locale: Locale) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatLocalizedDateTime(date, locale);
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

const renderCellValue = (rowKey: string, value: unknown, locale: Locale) => {
  if (rowKey === "price_min" || rowKey === "price_max") {
    const numeric = parseNumeric(value);
    if (numeric !== null) return `${formatNumber(Math.round(numeric), locale, { maximumFractionDigits: 0 })} UZS`;
  }
  if (rowKey.includes("color") && typeof value === "string") return formatColorValue(value);
  return normalizeValue(value, locale);
};

const isImageUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return /^https?:\/\//i.test(normalized);
};

export function CompareClientPage() {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);
  const itemCountLabel = (count: number) => {
    if (isUz) return `${count} та товар`;
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return `${count} товар`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} товара`;
    return `${count} товаров`;
  };

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
        setShareStatus(tr("Не удалось восстановить сравнение по ссылке.", "Солиштиришни ҳавола орқали тиклаб бўлмади."));
        return;
      }
      replace(nextItems);
      setAppliedShareToken(shareToken);
      setShareStatus(
        tr(
          `Сравнение загружено по общей ссылке до ${formatDateTime(sharedCompareQuery.data.expires_at, locale)}.`,
          `Солиштириш умумий ҳавола орқали ${formatDateTime(sharedCompareQuery.data.expires_at, locale)} гача юкланди.`
        )
      );
    };
    void hydrateSharedCompare();
    return () => {
      cancelled = true;
    };
  }, [appliedShareToken, compareItems, replace, shareToken, sharedCompareQuery.data]);

  useEffect(() => {
    if (!shareToken || !sharedCompareQuery.isError) return;
    setShareStatus(tr("Ссылка сравнения недействительна или устарела.", "Солиштириш ҳаволаси амал қилмайди ёки эскирган."));
  }, [shareToken, sharedCompareQuery.isError, tr]);

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
      return { key, label: formatSpecLabel(key, locale), values, bestCellIndexes: getBestCellIndexes(key, values) };
    });

    const normalizedQuery = specQuery.trim().toLowerCase();

    return allRows.filter((row) => {
      if (onlyDiff && !hasDiffInRow(row.values, locale)) return false;
      if (
        focusMode === "key" &&
        !keySpecHints.some((hint) => row.key.toLowerCase().includes(hint) || row.label.toLowerCase().includes(hint))
      ) {
        return false;
      }
      if (!normalizedQuery) return true;
      return row.key.toLowerCase().includes(normalizedQuery) || row.label.toLowerCase().includes(normalizedQuery);
    });
  }, [compareQuery.data?.items, focusMode, locale, onlyDiff, specQuery]);

  const diffRowsCount = useMemo(() => rows.filter((row) => hasDiffInRow(row.values, locale)).length, [locale, rows]);

  const onCreateShareLink = async () => {
    if (productIds.length < 2) {
      setShareStatus(tr("Для общей ссылки выберите минимум 2 товара.", "Умумий ҳавола учун камида 2 та товар танланг."));
      return;
    }
    try {
      const response = await createShare.mutateAsync({ productIds, ttlDays: 30, source: "compare_page" });
      const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${response.share_path}` : response.share_path;
      setLastShareUrl(shareUrl);
      setLastShareExpiresAt(response.expires_at);
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ url: shareUrl, title: tr("Сравнение товаров", "Товарларни солиштириш") });
        setShareStatus(tr("Ссылка сравнения отправлена через системный share.", "Солиштириш ҳаволаси тизимли share орқали юборилди."));
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareStatus(tr("Ссылка сравнения скопирована в буфер.", "Солиштириш ҳаволаси буферга нусхаланди."));
        return;
      }
      setShareStatus(
        tr(
          `Ссылка сравнения готова до ${formatDateTime(response.expires_at, locale)}.`,
          `Солиштириш ҳаволаси ${formatDateTime(response.expires_at, locale)} гача тайёр.`
        )
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setShareStatus(tr("Отправка ссылки отменена.", "Ҳаволани юбориш бекор қилинди."));
        return;
      }
      setShareStatus(tr("Не удалось создать ссылку сравнения.", "Солиштириш ҳаволасини яратиб бўлмади."));
    }
  };

  if (compareItems.length === 0) {
    return (
      <div className="mx-auto max-w-7xl space-y-3 px-4 py-6">
        {shareToken ? (
          <p className="text-sm text-muted-foreground">
            {sharedCompareQuery.isPending
              ? tr("Загружаем сравнение по ссылке...", "Ҳавола бўйича солиштириш юкланмоқда...")
              : shareStatus ?? tr("Ожидаем данные сравнения...", "Солиштириш маълумотларини кутмоқдамиз...")}
          </p>
        ) : null}
        <EmptyState
          title={tr("Сравнение пока пустое", "Солиштириш ҳозирча бўш")}
          message={tr("Добавьте товары из каталога или карточки товара, чтобы начать сравнение.", "Солиштиришни бошлаш учун каталогдан ёки товар карточкасидан товар қўшинг.")}
        />
        <Link href="/catalog">
          <Button>{tr("Перейти в каталог", "Каталогга ўтиш")}</Button>
        </Link>
        {history.length ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{tr("Недавние сравнения", "Охирги солиштиришлар")}</CardTitle>
              <Button variant="ghost" size="sm" onClick={clearHistory}>
                {tr("Очистить историю", "Тарихни тозалаш")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.slice(0, 6).map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div>
                    <p className="line-clamp-1 text-sm font-medium">{entry.items.map((item) => item.title).join(" vs ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt, locale)} | {itemCountLabel(entry.items.length)}
                      {entry.category ? ` | ${formatCategory(entry.category)}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                    {tr("Восстановить", "Тиклаш")}
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
            <CardTitle>{tr("Для сравнения нужно минимум 2 товара", "Солиштириш учун камида 2 та товар керак")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {tr(
                "Сейчас выбран только один товар. Добавьте ещё один, чтобы увидеть полную матрицу сравнения.",
                "Ҳозир фақат битта товар танланган. Тўлиқ матрицани кўриш учун яна бир товар қўшинг."
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/product/${onlyItem.slug}`}>
                <Button variant="outline">{tr("Открыть выбранный товар", "Танланган товарни очиш")}</Button>
              </Link>
              <Link href="/catalog">
                <Button>{tr("Добавить ещё товар", "Яна товар қўшиш")}</Button>
              </Link>
              <Button variant="ghost" onClick={clear}>
                {tr("Очистить", "Тозалаш")}
              </Button>
            </div>
            {history.length ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">{tr("Недавние сравнения:", "Охирги солиштиришлар:")}</p>
                <div className="flex flex-wrap gap-2">
                  {history.slice(0, 4).map((entry) => (
                    <Button key={entry.id} size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                      {tr("Восстановить", "Тиклаш")} {entry.items.length}
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
        <ErrorState
          title={tr("Не удалось построить сравнение", "Солиштиришни тузиб бўлмади")}
          message={tr("Попробуйте убрать недоступные товары и повторите.", "Мавжуд эмас товарларни олиб ташлаб, қайта уриниб кўринг.")}
        />
      </div>
    );
  }

  const columns = compareQuery.data?.items ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-7xl space-y-6 px-4 py-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-extrabold">{tr("Сравнение", "Солиштириш")}</h1>
            <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium">
              {tr(`${compareItems.length}/${COMPARE_LIMIT} выбрано`, `${compareItems.length}/${COMPARE_LIMIT} танланган`)}
            </span>
            {categoryScope ? (
              <span className="rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
                {formatCategory(categoryScope)}
              </span>
            ) : null}
            {compareQuery.isFetching ? (
              <span className="rounded-md bg-secondary px-2.5 py-1 text-xs text-muted-foreground">{tr("Обновляем...", "Янгиланмоқда...")}</span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {tr(
              "Сравнение работает в рамках одной категории. Заголовки и первая колонка закреплены.",
              "Солиштириш битта категория доирасида ишлайди. Сарлавҳа ва биринчи устун қотирилган."
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-1 text-success">
              <span className="h-2 w-2 rounded-full bg-success" /> {tr("Лучшее значение", "Энг яхши қиймат")}
            </span>
            <span>{tr("Подсветка лучшего значения рассчитывается по эвристике.", "Энг яхши қиймат ёритилиши эвристика асосида ҳисобланади.")}</span>
          </div>
          {shareStatus ? <p className="text-xs text-accent">{shareStatus}</p> : null}
          {lastShareUrl ? (
            <p className="text-xs text-muted-foreground">
              {tr("Ссылка:", "Ҳавола:")}{" "}
              <a href={lastShareUrl} className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer">
                {tr("открыть", "очиш")}
              </a>
              {lastShareExpiresAt
                ? tr(
                  ` (действует до ${formatDateTime(lastShareExpiresAt, locale)})`,
                  ` (амал қилади: ${formatDateTime(lastShareExpiresAt, locale)})`
                )
                : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={onlyDiff ? "default" : "outline"} size="sm" onClick={() => setOnlyDiff((prev) => !prev)}>
            {onlyDiff ? tr("Показаны отличия", "Фарқлар кўрсатилган") : tr("Показать только отличия", "Фақат фарқларни кўрсатиш")}
          </Button>
          <Button variant={focusMode === "key" ? "default" : "outline"} size="sm" onClick={() => setFocusMode((prev) => (prev === "all" ? "key" : "all"))}>
            {focusMode === "key" ? tr("Ключевые характеристики", "Калит хусусиятлар") : tr("Фокус: ключевые", "Фокус: калит")}
          </Button>
          <Button variant="outline" size="sm" onClick={onCreateShareLink} disabled={createShare.isPending || productIds.length < 2}>
            {createShare.isPending ? tr("Готовим ссылку...", "Ҳавола тайёрланмоқда...") : tr("Поделиться", "Улашиш")}
          </Button>
          <Button variant="ghost" size="sm" onClick={clear}>
            {tr("Очистить всё", "Барчасини тозалаш")}
          </Button>
          {history.length ? (
            <Button variant="ghost" size="sm" onClick={clearHistory}>
              {tr("Очистить историю", "Тарихни тозалаш")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(280px,420px)_1fr] md:items-center">
        <Input
          value={specQuery}
          onChange={(event) => setSpecQuery(event.target.value)}
          placeholder={tr("Поиск по характеристикам: например, камера, ram, wifi", "Хусусият бўйича қидирув: масалан, камера, ram, wifi")}
          aria-label={tr("Поиск характеристики в матрице сравнения", "Солиштириш матрицасида хусусият қидириш")}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">
          {tr(`Строк в матрице: ${rows.length}, отличий: ${diffRowsCount}.`, `Матрица қаторлари: ${rows.length}, фарқлар: ${diffRowsCount}.`)}
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
              <Link href={`/product/${item.slug}`} className="line-clamp-2 text-sm font-semibold text-accent hover:underline">
                {item.title}
              </Link>
              <div className="flex gap-2">
                <Link href={`/product/${item.slug}`}>
                  <Button size="sm" variant="outline">
                    {tr("Открыть", "Очиш")}
                  </Button>
                </Link>
                <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>
                  {tr("Убрать", "Олиб ташлаш")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {compareQuery.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">{tr("Загружаем матрицу сравнения...", "Солиштириш матрицаси юкланмоқда...")}</div>
          ) : (
            <table className="min-w-[760px] w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="sticky left-0 top-0 z-30 min-w-56 bg-card px-4 py-3 text-left text-sm font-semibold">{tr("Характеристика", "Хусусият")}</th>
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
                          <Link href={`/product/${slug}`} className="font-medium hover:text-accent">
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
                    <td className="sticky left-0 z-10 bg-card px-4 py-3 text-sm text-muted-foreground">{tr("Отличий не найдено", "Фарқлар топилмади")}</td>
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
                          {renderCellValue(row.key, value, locale)}
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
            <CardTitle>{tr("Недавние сравнения", "Охирги солиштиришлар")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {history.slice(0, 6).map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                <div>
                  <p className="line-clamp-1 text-sm font-medium">{entry.items.map((item) => item.title).join(" vs ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt, locale)} | {itemCountLabel(entry.items.length)}
                    {entry.category ? ` | ${formatCategory(entry.category)}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => restoreSnapshot(entry.id)}>
                  {tr("Восстановить", "Тиклаш")}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </motion.div>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
