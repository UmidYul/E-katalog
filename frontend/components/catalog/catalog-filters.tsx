"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
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

const clampPrice = (value: number, upperBound: number) => Math.min(Math.max(Math.round(value), PRICE_MIN), upperBound);

const normalizePriceRange = (next: number[], upperBound: number): [number, number] => {
  const from = clampPrice(next[0] ?? PRICE_MIN, upperBound);
  const to = clampPrice(next[1] ?? upperBound, upperBound);
  return [Math.min(from, to), Math.max(from, to)];
};

const countActiveFilters = (value: FilterState, priceMaxBound: number): number => {
  const attrCount = Object.values(value.attrs ?? {}).reduce((acc, values) => acc + values.length, 0);
  const hasMinPrice = value.minPrice !== undefined && value.minPrice > PRICE_MIN;
  const hasMaxPrice = value.maxPrice !== undefined && value.maxPrice < priceMaxBound;

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
  priceMaxBound,
  value,
  onChange,
}: {
  brands: Array<{ id: string; name: string }>;
  stores?: Array<{ id: string; name: string }>;
  sellers?: Array<{ id: string; name: string }>;
  dynamicAttributes?: Array<{ key: string; label: string; values: Array<{ value: string; label: string; count?: number }> }>;
  priceMaxBound?: number;
  value: FilterState;
  onChange: (v: FilterState) => void;
}) {
  const effectivePriceMax = Math.max(PRICE_MIN + 1, Math.round(priceMaxBound ?? PRICE_MAX));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>(
    normalizePriceRange([value.minPrice ?? PRICE_MIN, value.maxPrice ?? effectivePriceMax], effectivePriceMax)
  );
  const activeFilterCount = useMemo(() => countActiveFilters(value, effectivePriceMax), [effectivePriceMax, value]);
  const hasActiveFilters = activeFilterCount > 0;

  useEffect(() => {
    setPriceRange(normalizePriceRange([value.minPrice ?? PRICE_MIN, value.maxPrice ?? effectivePriceMax], effectivePriceMax));
  }, [effectivePriceMax, value.maxPrice, value.minPrice]);

  const priceLabel = useMemo(() => {
    const [from, to] = priceRange;
    if (from <= PRICE_MIN && to >= effectivePriceMax) return "Любая цена";
    return `${numberFormatter.format(from)} - ${numberFormatter.format(to)} UZS`;
  }, [effectivePriceMax, priceRange]);

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
      attrs: undefined,
    });
  };

  const panel = (
    <div className="space-y-1">
      {/* Search */}
      <FilterSection title="Поиск" defaultOpen>
        <Input
          value={value.q ?? ""}
          onChange={(e) => onChange({ ...value, q: e.target.value || undefined })}
          placeholder="Название модели..."
        />
      </FilterSection>

      {/* Sort */}
      <FilterSection title="Сортировка" defaultOpen>
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
      </FilterSection>

      {/* Price */}
      <FilterSection title="Диапазон цен" defaultOpen>
        <Slider
          value={priceRange}
          min={PRICE_MIN}
          max={effectivePriceMax}
          onValueChange={(next) => setPriceRange(normalizePriceRange(next, effectivePriceMax))}
          onValueCommit={(next) => {
            const normalized = normalizePriceRange(next, effectivePriceMax);
            setPriceRange(normalized);
            onChange({
              ...value,
              minPrice: normalized[0] > PRICE_MIN ? normalized[0] : undefined,
              maxPrice: normalized[1] < effectivePriceMax ? normalized[1] : undefined,
            });
          }}
        />
        <p className="mt-2 text-xs font-medium text-accent">{priceLabel}</p>
      </FilterSection>

      {/* Brands */}
      {brands.length > 0 && (
        <FilterSection title="Бренды" badge={value.brands.length || undefined} defaultOpen={value.brands.length > 0}>
          <div className="max-h-52 space-y-0.5 overflow-y-auto pr-1">
            {brands.map((brand) => {
              const active = value.brands.includes(brand.id);
              return (
                <CheckItem
                  key={brand.id}
                  label={brand.name}
                  checked={active}
                  onChange={() => {
                    const next = active ? value.brands.filter((id) => id !== brand.id) : [...value.brands, brand.id];
                    onChange({ ...value, brands: next });
                  }}
                />
              );
            })}
          </div>
        </FilterSection>
      )}

      {/* Stores */}
      {!!stores?.length && (
        <FilterSection title="Магазины" badge={value.stores.length || undefined}>
          <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
            {stores.map((store) => {
              const active = value.stores.includes(store.id);
              return (
                <CheckItem
                  key={store.id}
                  label={store.name}
                  checked={active}
                  onChange={() => {
                    const next = active ? value.stores.filter((id) => id !== store.id) : [...value.stores, store.id];
                    onChange({ ...value, stores: next });
                  }}
                />
              );
            })}
          </div>
        </FilterSection>
      )}

      {/* Sellers */}
      {!!sellers?.length && (
        <FilterSection title="Продавцы" badge={value.sellers.length || undefined}>
          <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
            {sellers.slice(0, 20).map((seller) => {
              const active = value.sellers.includes(seller.id);
              return (
                <CheckItem
                  key={seller.id}
                  label={seller.name}
                  checked={active}
                  onChange={() => {
                    const next = active ? value.sellers.filter((id) => id !== seller.id) : [...value.sellers, seller.id];
                    onChange({ ...value, sellers: next });
                  }}
                />
              );
            })}
          </div>
        </FilterSection>
      )}

      {/* Delivery */}
      <FilterSection title="Макс. дней доставки">
        <Input
          type="number"
          min={0}
          max={30}
          value={value.maxDeliveryDays ?? ""}
          onChange={(e) => onChange({ ...value, maxDeliveryDays: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="Без ограничения"
        />
      </FilterSection>

      {/* Dynamic attributes */}
      {dynamicAttributes?.map((attribute) => (
        <FilterSection key={attribute.key} title={attribute.label} badge={value.attrs?.[attribute.key]?.length || undefined}>
          <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
            {attribute.values.map((option) => {
              const selected = value.attrs?.[attribute.key]?.includes(option.value) ?? false;
              return (
                <CheckItem
                  key={option.value}
                  label={option.label}
                  checked={selected}
                  count={option.count}
                  onChange={() => {
                    const current = value.attrs?.[attribute.key] ?? [];
                    const nextValues = selected ? current.filter((v) => v !== option.value) : [...current, option.value];
                    const nextAttrs = { ...(value.attrs ?? {}) };
                    if (nextValues.length) nextAttrs[attribute.key] = nextValues;
                    else delete nextAttrs[attribute.key];
                    onChange({ ...value, attrs: Object.keys(nextAttrs).length ? nextAttrs : undefined });
                  }}
                />
              );
            })}
          </div>
        </FilterSection>
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop sticky sidebar */}
      <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-bold">Фильтры</p>
              <AnimatePresence>
                {hasActiveFilters && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="text-xs text-accent"
                  >
                    {activeFilterCount} активных
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {hasActiveFilters && (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <RotateCcw className="h-3 w-3" />
                    Сбросить
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-3 py-3">{panel}</div>
        </div>
      </aside>

      {/* Mobile trigger */}
      <div className="lg:hidden">
        <Sheet name="filters" open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Фильтры
              {hasActiveFilters && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="p-0">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
                <p className="font-bold">Фильтры</p>
                <Button variant="ghost" size="sm" disabled={!hasActiveFilters} onClick={resetFilters} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Сбросить
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">{panel}</div>
              <div className="border-t border-border p-4">
                <Button className="w-full" onClick={() => setMobileOpen(false)}>
                  Показать результаты
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

/* ─── Sub-components ─────────────────────────────────────────── */

function FilterSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-3 text-left text-sm font-medium transition-colors hover:text-accent"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
              {badge}
            </span>
          ) : null}
        </span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CheckItem({
  label,
  checked,
  count,
  onChange,
}: {
  label: string;
  checked: boolean;
  count?: number;
  onChange: () => void;
}) {
  return (
    <label onClick={onChange} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/60">
      <span
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${checked ? "border-accent bg-accent" : "border-border bg-background"
          }`}
      >
        {checked && (
          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L4 7L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={`flex-1 text-sm ${checked ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
      {count !== undefined && <span className="text-xs text-muted-foreground/70">{count}</span>}
    </label>
  );
}
