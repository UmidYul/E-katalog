"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";

export type FilterState = {
  q?: string;
  sort: "relevance" | "price_asc" | "price_desc" | "popular" | "newest";
  brands: string[];
  stores: string[];
  sellers: string[];
  minPrice?: number;
  maxPrice?: number;
  maxDeliveryDays?: number;
  attrs?: Record<string, string[]>;
};

const PRICE_MIN = 0;
const PRICE_MAX = 100_000_000;
const DEFAULT_SORT: FilterState["sort"] = "popular";
const numberFormatter = new Intl.NumberFormat("en-US");

const normalizePriceRange = (next: number[]): [number, number] => [
  Math.min(next[0] ?? PRICE_MIN, next[1] ?? PRICE_MAX),
  Math.max(next[0] ?? PRICE_MIN, next[1] ?? PRICE_MAX)
];

const countActiveFilters = (value: FilterState): number => {
  const attrCount = Object.values(value.attrs ?? {}).reduce((acc, values) => acc + values.length, 0);
  const hasMinPrice = value.minPrice !== undefined && value.minPrice > PRICE_MIN;
  const hasMaxPrice = value.maxPrice !== undefined && value.maxPrice < PRICE_MAX;

  return (
    (value.q?.trim() ? 1 : 0) +
    (value.sort !== DEFAULT_SORT ? 1 : 0) +
    value.brands.length +
    value.stores.length +
    value.sellers.length +
    (hasMinPrice ? 1 : 0) +
    (hasMaxPrice ? 1 : 0) +
    (value.maxDeliveryDays !== undefined ? 1 : 0) +
    attrCount
  );
};

export function CatalogFilters({
  brands,
  stores,
  sellers,
  dynamicAttributes,
  value,
  onChange
}: {
  brands: Array<{ id: string; name: string }>;
  stores?: Array<{ id: string; name: string }>;
  sellers?: Array<{ id: string; name: string }>;
  dynamicAttributes?: Array<{ key: string; label: string; values: Array<{ value: string; label: string; count?: number }> }>;
  value: FilterState;
  onChange: (v: FilterState) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([value.minPrice ?? PRICE_MIN, value.maxPrice ?? PRICE_MAX]);
  const activeFilterCount = useMemo(() => countActiveFilters(value), [value]);
  const hasActiveFilters = activeFilterCount > 0;

  useEffect(() => {
    setPriceRange([value.minPrice ?? PRICE_MIN, value.maxPrice ?? PRICE_MAX]);
  }, [value.maxPrice, value.minPrice]);

  const priceLabel = useMemo(() => {
    const [from, to] = priceRange;
    if (from <= PRICE_MIN && to >= PRICE_MAX) return "Любая цена";
    return `${numberFormatter.format(from)} - ${numberFormatter.format(to)} UZS`;
  }, [priceRange]);

  const resetFilters = () => {
    onChange({
      q: undefined,
      sort: DEFAULT_SORT,
      brands: [],
      stores: [],
      sellers: [],
      minPrice: undefined,
      maxPrice: undefined,
      maxDeliveryDays: undefined,
      attrs: undefined
    });
  };

  const panel = (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Поиск</label>
        <Input value={value.q ?? ""} onChange={(e) => onChange({ ...value, q: e.target.value || undefined })} placeholder="Название модели..." />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Сортировка</label>
        <Select value={value.sort} onValueChange={(next) => onChange({ ...value, sort: next as FilterState["sort"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Популярные</SelectItem>
            <SelectItem value="relevance">Релевантные</SelectItem>
            <SelectItem value="price_asc">Цена: по возрастанию</SelectItem>
            <SelectItem value="price_desc">Цена: по убыванию</SelectItem>
            <SelectItem value="newest">Сначала новые</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Диапазон цен</label>
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
              minPrice: normalized[0] > PRICE_MIN ? normalized[0] : undefined,
              maxPrice: normalized[1] < PRICE_MAX ? normalized[1] : undefined
            });
          }}
        />
        <p className="text-xs text-muted-foreground">{priceLabel}</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Бренды</label>
        <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
          {brands.map((brand) => {
            const active = value.brands.includes(brand.id);
            return (
              <label key={brand.id} className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => {
                    const next = active ? value.brands.filter((id) => id !== brand.id) : [...value.brands, brand.id];
                    onChange({ ...value, brands: next });
                  }}
                />
                {brand.name}
              </label>
            );
          })}
        </div>
      </div>

      {!!stores?.length && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Магазины</label>
          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
            {stores.map((store) => {
              const active = value.stores.includes(store.id);
              return (
                <label key={store.id} className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => {
                      const next = active ? value.stores.filter((id) => id !== store.id) : [...value.stores, store.id];
                      onChange({ ...value, stores: next });
                    }}
                  />
                  {store.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {!!sellers?.length && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Продавцы</label>
          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
            {sellers.slice(0, 20).map((seller) => {
              const active = value.sellers.includes(seller.id);
              return (
                <label key={seller.id} className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => {
                      const next = active ? value.sellers.filter((id) => id !== seller.id) : [...value.sellers, seller.id];
                      onChange({ ...value, sellers: next });
                    }}
                  />
                  {seller.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Макс. дней доставки</label>
        <Input
          type="number"
          min={0}
          max={30}
          value={value.maxDeliveryDays ?? ""}
          onChange={(e) => onChange({ ...value, maxDeliveryDays: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="Без ограничения"
        />
      </div>

      {dynamicAttributes?.map((attribute) => (
        <div key={attribute.key} className="space-y-2">
          <label className="text-sm font-medium">{attribute.label}</label>
          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
            {attribute.values.map((option) => {
              const selected = value.attrs?.[attribute.key]?.includes(option.value) ?? false;
              return (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const current = value.attrs?.[attribute.key] ?? [];
                      const nextValues = selected ? current.filter((v) => v !== option.value) : [...current, option.value];
                      const nextAttrs = { ...(value.attrs ?? {}) };
                      if (nextValues.length) {
                        nextAttrs[attribute.key] = nextValues;
                      } else {
                        delete nextAttrs[attribute.key];
                      }
                      onChange({
                        ...value,
                        attrs: Object.keys(nextAttrs).length ? nextAttrs : undefined
                      });
                    }}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border p-4">
            <div>
              <p className="text-sm font-semibold">Фильтры</p>
              <p className="text-xs text-muted-foreground">{hasActiveFilters ? `Активных: ${activeFilterCount}` : "Активных фильтров нет"}</p>
            </div>
            <Button variant="ghost" size="sm" disabled={!hasActiveFilters} onClick={resetFilters}>
              Сбросить
            </Button>
          </div>
          <div className="max-h-[calc(100vh-6.5rem)] overflow-y-auto p-4">{panel}</div>
        </div>
      </aside>
      <div className="lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> Фильтры{hasActiveFilters ? ` (${activeFilterCount})` : ""}
            </Button>
          </SheetTrigger>
          <SheetContent className="p-0">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4 pr-14">
                <div>
                  <p className="text-sm font-semibold">Фильтры</p>
                  <p className="text-xs text-muted-foreground">{hasActiveFilters ? `Активных: ${activeFilterCount}` : "Активных фильтров нет"}</p>
                </div>
                <Button variant="ghost" size="sm" disabled={!hasActiveFilters} onClick={resetFilters}>
                  Сбросить
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 pt-4">{panel}</div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

