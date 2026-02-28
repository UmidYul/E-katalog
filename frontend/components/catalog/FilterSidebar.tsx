"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Star } from "lucide-react";

import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";
import type { FilterState } from "@/components/catalog/catalog-filters";

const PRICE_MIN = 0;
const PRICE_MAX = 100_000_000;
const numberFormatter = new Intl.NumberFormat("en-US");

const normalizePriceRange = (next: number[]): [number, number] => [
  Math.min(next[0] ?? PRICE_MIN, next[1] ?? PRICE_MAX),
  Math.max(next[0] ?? PRICE_MIN, next[1] ?? PRICE_MAX)
];

type FilterSidebarProps = {
  value: FilterState;
  onChange: (next: FilterState) => void;
  brands: Array<{ id: string; name: string }>;
  stores?: Array<{ id: string; name: string }>;
  sellers?: Array<{ id: string; name: string }>;
  dynamicAttributes?: Array<{
    key: string;
    label: string;
    values: Array<{ value: string; label: string; count?: number }>;
  }>;
  activeFilterCount: number;
  hasActiveFilters: boolean;
  onReset: () => void;
  className?: string;
};

export function FilterSidebar({
  value,
  onChange,
  brands,
  stores,
  sellers,
  dynamicAttributes,
  activeFilterCount,
  hasActiveFilters,
  onReset,
  className
}: FilterSidebarProps) {
  const [priceRange, setPriceRange] = useState<[number, number]>([
    value.minPrice ?? PRICE_MIN,
    value.maxPrice ?? PRICE_MAX
  ]);
  const [brandSearch, setBrandSearch] = useState("");
  const [showAllBrands, setShowAllBrands] = useState(false);

  useEffect(() => {
    setPriceRange([value.minPrice ?? PRICE_MIN, value.maxPrice ?? PRICE_MAX]);
  }, [value.maxPrice, value.minPrice]);

  const priceLabel = useMemo(() => {
    const [from, to] = priceRange;
    if (from <= PRICE_MIN && to >= PRICE_MAX) return "Любая цена";
    return `${numberFormatter.format(from)} - ${numberFormatter.format(to)} UZS`;
  }, [priceRange]);

  const filteredBrands = useMemo(() => {
    const query = brandSearch.trim().toLowerCase();
    if (!query) return brands;
    return brands.filter((brand) => brand.name.toLowerCase().includes(query));
  }, [brandSearch, brands]);

  const [visibleBrands, hiddenCount] = useMemo(() => {
    if (showAllBrands) return [filteredBrands, 0];
    const slice = filteredBrands.slice(0, 6);
    return [slice, Math.max(filteredBrands.length - slice.length, 0)];
  }, [filteredBrands, showAllBrands]);

  const ratingAttr = value.attrs?.rating?.[0];
  const currentRating =
    ratingAttr === "gte:4" ? "4" : ratingAttr === "gte:3" ? "3" : "any";

  const inStockEnabled = (value.attrs?.in_stock ?? []).includes("true");

  const updateAttrs = (nextAttrs: FilterState["attrs"]) =>
    onChange({
      ...value,
      attrs: nextAttrs && Object.keys(nextAttrs).length ? nextAttrs : undefined
    });

  const setRatingFilter = (mode: "4" | "3" | "any") => {
    const current = { ...(value.attrs ?? {}) };
    if (mode === "any") {
      delete current.rating;
      updateAttrs(current);
      return;
    }
    current.rating = [mode === "4" ? "gte:4" : "gte:3"];
    updateAttrs(current);
  };

  const setInStockFilter = (enabled: boolean) => {
    const current = { ...(value.attrs ?? {}) };
    if (!enabled) {
      delete current.in_stock;
      updateAttrs(current);
      return;
    }
    current.in_stock = ["true"];
    updateAttrs(current);
  };

  const handlePriceInputChange = (type: "min" | "max", raw: string) => {
    const parsed = raw.trim() ? Number(raw) : undefined;
    const safe = Number.isFinite(parsed ?? NaN) ? (parsed as number) : undefined;
    const nextMin = type === "min" ? safe : value.minPrice;
    const nextMax = type === "max" ? safe : value.maxPrice;
    const normalized = normalizePriceRange([
      nextMin ?? PRICE_MIN,
      nextMax ?? PRICE_MAX
    ]);
    const min = normalized[0] > PRICE_MIN ? normalized[0] : undefined;
    const max = normalized[1] < PRICE_MAX ? normalized[1] : undefined;
    setPriceRange(normalized);
    onChange({
      ...value,
      minPrice: min,
      maxPrice: max
    });
  };

  const content = (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Фильтры</p>
            <p className="text-xs text-muted-foreground">
              {hasActiveFilters
                ? `Активных: ${activeFilterCount}`
                : "Активных фильтров нет"}
            </p>
          </div>
        </div>
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={onReset}
          >
            Сбросить
          </Button>
        ) : null}
      </div>

      <Accordion
        items={[
          {
            id: "price",
            title: "Цена",
            content: (
              <div className="space-y-3">
                <Slider
                  value={priceRange}
                  min={PRICE_MIN}
                  max={PRICE_MAX}
                  onValueChange={(next) => {
                    setPriceRange(normalizePriceRange(next));
                  }}
                  onValueCommit={(next) => {
                    const normalized = normalizePriceRange(next);
                    setPriceRange(normalized);
                    onChange({
                      ...value,
                      minPrice:
                        normalized[0] > PRICE_MIN ? normalized[0] : undefined,
                      maxPrice:
                        normalized[1] < PRICE_MAX ? normalized[1] : undefined
                    });
                  }}
                />
                <p className="text-xs text-muted-foreground">{priceLabel}</p>
                <div className="flex items-center gap-2">
                  <Input
                    inputMode="numeric"
                    className="h-8 text-xs"
                    placeholder="Мин"
                    value={value.minPrice ?? ""}
                    onChange={(e) =>
                      handlePriceInputChange("min", e.target.value)
                    }
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <Input
                    inputMode="numeric"
                    className="h-8 text-xs"
                    placeholder="Макс"
                    value={value.maxPrice ?? ""}
                    onChange={(e) =>
                      handlePriceInputChange("max", e.target.value)
                    }
                  />
                </div>
              </div>
            )
          },
          {
            id: "brands",
            title: "Бренды",
            content: (
              <div className="space-y-3">
                <Input
                  placeholder="Поиск по брендам..."
                  className="h-8 text-xs"
                  value={brandSearch}
                  onChange={(e) => setBrandSearch(e.target.value)}
                />
                <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {visibleBrands.map((brand) => {
                    const active = value.brands.includes(brand.id);
                    return (
                      <button
                        key={brand.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs text-muted-foreground hover:bg-secondary/60"
                        onClick={() => {
                          const next = active
                            ? value.brands.filter((id) => id !== brand.id)
                            : [...value.brands, brand.id];
                          onChange({ ...value, brands: next });
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Checkbox checked={active} onCheckedChange={() => {}} />
                          <span>{brand.name}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllBrands(true)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Ещё {hiddenCount}
                  </button>
                ) : null}
              </div>
            )
          },
          {
            id: "rating",
            title: "Рейтинг",
            content: (
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1",
                    currentRating === "4"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground/80 hover:border-primary/40"
                  )}
                  onClick={() => setRatingFilter("4")}
                >
                  4
                  <Star className="h-3 w-3 fill-current" />+
                </button>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1",
                    currentRating === "3"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground/80 hover:border-primary/40"
                  )}
                  onClick={() => setRatingFilter("3")}
                >
                  3
                  <Star className="h-3 w-3 fill-current" />+
                </button>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1",
                    currentRating === "any"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-card text-foreground/80 hover:border-primary/40"
                  )}
                  onClick={() => setRatingFilter("any")}
                >
                  Любой
                </button>
              </div>
            )
          },
          {
            id: "stock",
            title: "Наличие",
            content: (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Только в наличии</span>
                <Switch
                  checked={inStockEnabled}
                  onCheckedChange={(checked) => setInStockFilter(checked)}
                />
              </div>
            )
          }
        ]}
      />

      {(stores?.length || sellers?.length || dynamicAttributes?.length) && (
        <div className="space-y-3">
          {stores?.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Магазины</p>
              <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                {stores.map((store) => {
                  const active = value.stores.includes(store.id);
                  return (
                    <button
                      key={store.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs text-muted-foreground hover:bg-secondary/60"
                      onClick={() => {
                        const next = active
                          ? value.stores.filter((id) => id !== store.id)
                          : [...value.stores, store.id];
                        onChange({ ...value, stores: next });
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Checkbox checked={active} onCheckedChange={() => {}} />
                        <span>{store.name}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {sellers?.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Продавцы</p>
              <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                {sellers.slice(0, 20).map((seller) => {
                  const active = value.sellers.includes(seller.id);
                  return (
                    <button
                      key={seller.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-xs text-muted-foreground hover:bg-secondary/60"
                      onClick={() => {
                        const next = active
                          ? value.sellers.filter((id) => id !== seller.id)
                          : [...value.sellers, seller.id];
                        onChange({ ...value, sellers: next });
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Checkbox checked={active} onCheckedChange={() => {}} />
                        <span>{seller.name}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {dynamicAttributes?.map((attribute) => (
            <div key={attribute.key} className="space-y-2">
              <p className="text-sm font-medium">{attribute.label}</p>
              <div className="flex flex-wrap gap-1">
                {attribute.values.map((option) => {
                  const selected =
                    value.attrs?.[attribute.key]?.includes(option.value) ??
                    false;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px]",
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-foreground/80 hover:border-primary/40"
                      )}
                      onClick={() => {
                        const current =
                          value.attrs?.[attribute.key] ?? [];
                        const nextValues = selected
                          ? current.filter((v) => v !== option.value)
                          : [...current, option.value];
                        const nextAttrs = { ...(value.attrs ?? {}) };
                        if (nextValues.length) {
                          nextAttrs[attribute.key] = nextValues;
                        } else {
                          delete nextAttrs[attribute.key];
                        }
                        updateAttrs(nextAttrs);
                      }}
                    >
                      {option.label}
                      {typeof option.count === "number" ? (
                        <Badge
                          variant="outline"
                          className="border-border/60 bg-background/60 text-[10px]"
                        >
                          {option.count}
                        </Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <aside
      className={cn(
        "hidden w-[260px] self-start lg:sticky lg:top-20 lg:block",
        className
      )}
    >
      <div className="card-base">
        <div className="max-h-[calc(100vh-6.5rem)] space-y-4 overflow-y-auto p-4">
          {content}
        </div>
      </div>
    </aside>
  );
}

