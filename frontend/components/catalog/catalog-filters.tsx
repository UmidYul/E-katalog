"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import {
  COMMON_DELIVERY_OPTIONS,
  COMMON_MIN_RATING_OPTIONS,
  DEFAULT_VISIBLE_CHECKBOX_OPTIONS,
  parseRangeValue,
  serializeRangeValue,
  type FilterGroup,
  type FilterOption,
} from "@/lib/filters/categoryFilters";

export type FilterState = {
  q?: string;
  sort: "relevance" | "price_asc" | "price_desc" | "popular" | "newest" | "discount" | "shop_count";
  brands: string[];
  stores: string[];
  sellers: string[];
  minPrice?: number;
  maxPrice?: number;
  deliveryDays: string[];
  inStock: boolean;
  hasDiscount: boolean;
  minRating: string[];
  attrs?: Record<string, string[]>;
};

type CategoryFacetCounts = Record<string, Record<string, number>>;

const PRICE_MIN = 0;
const PRICE_MAX = 100_000_000;
const COLLAPSE_STORAGE_PREFIX = "doxx_catalog_filter_sections";

const normalizePrice = (value: number, min: number, max: number) => Math.min(Math.max(Math.round(value), min), max);

const normalizeRange = (raw: number[], min: number, max: number): [number, number] => {
  const left = normalizePrice(raw[0] ?? min, min, max);
  const right = normalizePrice(raw[1] ?? max, min, max);
  return [Math.min(left, right), Math.max(left, right)];
};

const formatSum = (value: number) => `${new Intl.NumberFormat("uz-Cyrl-UZ").format(value)} сум`;

const parseNumberInput = (raw: string, fallback: number) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const countActive = (value: FilterState, minBound: number, maxBound: number) => {
  const attrCount = Object.values(value.attrs ?? {}).reduce((acc, list) => acc + list.length, 0);
  return (
    (value.q?.trim() ? 1 : 0) +
    value.brands.length +
    value.stores.length +
    value.sellers.length +
    (value.minPrice !== undefined && value.minPrice > minBound ? 1 : 0) +
    (value.maxPrice !== undefined && value.maxPrice < maxBound ? 1 : 0) +
    value.deliveryDays.length +
    (value.inStock ? 1 : 0) +
    (value.hasDiscount ? 1 : 0) +
    value.minRating.length +
    attrCount
  );
};

const toggleInArray = (list: string[], value: string) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);

const getAttrsForKey = (state: FilterState, key: string) => state.attrs?.[key] ?? [];

const setAttrsForKey = (state: FilterState, key: string, values: string[]) => {
  const nextAttrs = { ...(state.attrs ?? {}) };
  if (values.length) nextAttrs[key] = values;
  else delete nextAttrs[key];
  return { ...state, attrs: Object.keys(nextAttrs).length ? nextAttrs : undefined };
};

const getCollapseStorageKey = (categoryToken?: string | null) => `${COLLAPSE_STORAGE_PREFIX}:${categoryToken ?? "all"}`;

const safeReadJson = (raw: string | null): Record<string, boolean> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.entries(parsed).reduce<Record<string, boolean>>((acc, [key, value]) => {
      if (typeof value === "boolean") acc[key] = value;
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const formatRangeLabel = (value: number, unit?: string) => {
  const isInteger = Number.isInteger(value);
  const number = isInteger ? String(value) : String(Number(value.toFixed(1)));
  return unit ? `${number} ${unit}` : number;
};

const getRangeStateFromAttrs = (state: FilterState, key: string, min: number, max: number): [number, number] => {
  const raw = getAttrsForKey(state, key)[0];
  const parsed = raw ? parseRangeValue(raw) : null;
  if (!parsed) return [min, max];
  const safeMin = Math.max(min, Math.min(max, parsed.min));
  const safeMax = Math.max(min, Math.min(max, parsed.max));
  return [Math.min(safeMin, safeMax), Math.max(safeMin, safeMax)];
};

const getCheckboxOptionsWithCounts = (options: FilterOption[] | undefined, counts: Record<string, number> | undefined) =>
  (options ?? []).map((option) => ({
    ...option,
    count: counts?.[option.value],
  }));

export function CatalogFilters({
  categoryToken,
  categoryFilters,
  categoryFacetCounts,
  brands,
  stores,
  value,
  onChange,
  onReset,
}: {
  categoryToken?: string | null;
  categoryFilters: FilterGroup[];
  categoryFacetCounts?: CategoryFacetCounts;
  brands: Array<{ id: string; name: string; count?: number }>;
  stores?: Array<{ id: string; name: string; count?: number }>;
  value: FilterState;
  onChange: (next: FilterState) => void;
  onReset: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [brandSearch, setBrandSearch] = useState("");
  const [expandedCheckboxGroups, setExpandedCheckboxGroups] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [priceRange, setPriceRange] = useState<[number, number]>([value.minPrice ?? PRICE_MIN, value.maxPrice ?? PRICE_MAX]);
  const debounceRef = useRef<number | null>(null);

  const priceRangeQuery = useQuery({
    queryKey: ["catalog", "price-range", categoryToken ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (categoryToken) params.set("category", categoryToken);
      const response = await fetch(`/api/catalog/price-range${params.toString() ? `?${params.toString()}` : ""}`, { cache: "no-store" });
      if (!response.ok) return { min: PRICE_MIN, max: PRICE_MAX };
      return (await response.json()) as { min: number; max: number };
    },
    staleTime: 120_000,
  });

  const minBound = Math.max(PRICE_MIN, Math.round(priceRangeQuery.data?.min ?? PRICE_MIN));
  const maxBound = Math.max(minBound + 1, Math.round(priceRangeQuery.data?.max ?? PRICE_MAX));
  const activeCount = useMemo(() => countActive(value, minBound, maxBound), [value, minBound, maxBound]);

  useEffect(() => {
    setPriceRange(normalizeRange([value.minPrice ?? minBound, value.maxPrice ?? maxBound], minBound, maxBound));
  }, [value.minPrice, value.maxPrice, minBound, maxBound]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(getCollapseStorageKey(categoryToken));
      setCollapsedSections(safeReadJson(raw));
    } catch {
      setCollapsedSections({});
    }
  }, [categoryToken]);

  useEffect(() => {
    try {
      window.localStorage.setItem(getCollapseStorageKey(categoryToken), JSON.stringify(collapsedSections));
    } catch {
      // ignore storage errors
    }
  }, [categoryToken, collapsedSections]);

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    []
  );

  const brandOptions = useMemo(() => {
    const normalizedSearch = brandSearch.trim().toLowerCase();
    if (!normalizedSearch) return brands;
    return brands.filter((brand) => brand.name.toLowerCase().includes(normalizedSearch));
  }, [brandSearch, brands]);

  const commitPriceRange = (nextRange: [number, number], delayed: boolean) => {
    const normalized = normalizeRange(nextRange, minBound, maxBound);
    setPriceRange(normalized);

    const apply = () => {
      onChange({
        ...value,
        minPrice: normalized[0] > minBound ? normalized[0] : undefined,
        maxPrice: normalized[1] < maxBound ? normalized[1] : undefined,
      });
    };

    if (!delayed) {
      apply();
      return;
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(apply, 400);
  };

  const getSectionOpen = (sectionKey: string, defaultOpen: boolean) => {
    const collapsed = collapsedSections[sectionKey];
    if (collapsed === undefined) return defaultOpen;
    return !collapsed;
  };

  const setSectionOpen = (sectionKey: string, open: boolean) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !open,
    }));
  };

  const renderCheckboxGroup = ({
    groupKey,
    title,
    options,
    selectedValues,
    onToggle,
    sectionKey,
    defaultOpen,
  }: {
    groupKey: string;
    title: string;
    options: Array<{ value: string; label: string; count?: number }>;
    selectedValues: string[];
    onToggle: (option: string) => void;
    sectionKey: string;
    defaultOpen: boolean;
  }) => {
    const expanded = expandedCheckboxGroups[groupKey] ?? false;
    const hiddenCount = Math.max(0, options.length - DEFAULT_VISIBLE_CHECKBOX_OPTIONS);
    const visibleOptions =
      hiddenCount > 0 && !expanded ? options.slice(0, DEFAULT_VISIBLE_CHECKBOX_OPTIONS) : options;

    return (
      <FilterSection
        title={title}
        badge={selectedValues.length || undefined}
        open={getSectionOpen(sectionKey, defaultOpen)}
        onToggle={(open) => setSectionOpen(sectionKey, open)}
      >
        <div className="space-y-0.5">
          {visibleOptions.map((option) => {
            const checked = selectedValues.includes(option.value);
            const disabled = !checked && option.count === 0;
            return (
              <CheckItem
                key={`${groupKey}:${option.value}`}
                label={option.label}
                checked={checked}
                count={option.count}
                disabled={disabled}
                onChange={() => onToggle(option.value)}
              />
            );
          })}
        </div>

        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpandedCheckboxGroups((prev) => ({ ...prev, [groupKey]: !expanded }))}
            className="mt-2 text-xs font-semibold text-accent hover:underline"
          >
            {expanded ? "Камроқ" : `Яна ${hiddenCount} →`}
          </button>
        ) : null}
      </FilterSection>
    );
  };

  const renderCategoryGroup = (group: FilterGroup) => {
    const sectionKey = `cat.${group.key}`;

    if (group.type === "toggle") {
      const checked = getAttrsForKey(value, group.key)[0] === "true";
      return (
        <FilterSection
          key={group.key}
          title={group.label}
          open={getSectionOpen(sectionKey, true)}
          onToggle={(open) => setSectionOpen(sectionKey, open)}
        >
          <CheckItem
            label={group.label}
            checked={checked}
            onChange={() => onChange(setAttrsForKey(value, group.key, checked ? [] : ["true"]))}
          />
        </FilterSection>
      );
    }

    if (group.type === "range") {
      const min = group.min ?? 0;
      const max = group.max ?? min + 1;
      const rangeState = getRangeStateFromAttrs(value, group.key, min, max);

      return (
        <FilterSection
          key={group.key}
          title={group.label}
          badge={getAttrsForKey(value, group.key).length || undefined}
          open={getSectionOpen(sectionKey, true)}
          onToggle={(open) => setSectionOpen(sectionKey, open)}
        >
          <RangeFilterControl
            min={min}
            max={max}
            unit={group.unit}
            value={rangeState}
            onChange={(next) => {
              const shouldReset = next[0] === min && next[1] === max;
              onChange(setAttrsForKey(value, group.key, shouldReset ? [] : [serializeRangeValue(next[0], next[1])]));
            }}
          />
        </FilterSection>
      );
    }

    const options = getCheckboxOptionsWithCounts(group.options, categoryFacetCounts?.[group.key]);
    const selectedValues = getAttrsForKey(value, group.key);
    const defaultOpen = (group.options?.length ?? 0) < DEFAULT_VISIBLE_CHECKBOX_OPTIONS;

    return (
      <div key={group.key}>
        {renderCheckboxGroup({
          groupKey: group.key,
          title: group.label,
          options,
          selectedValues,
          onToggle: (optionValue) =>
            onChange(setAttrsForKey(value, group.key, toggleInArray(selectedValues, optionValue))),
          sectionKey,
          defaultOpen,
        })}
      </div>
    );
  };

  const renderPanel = () => (
    <div className="space-y-1">
      <FilterSection
        title="Қидириш"
        open={getSectionOpen("common.search", true)}
        onToggle={(open) => setSectionOpen("common.search", open)}
      >
        <Input
          value={value.q ?? ""}
          onChange={(event) => onChange({ ...value, q: event.target.value || undefined })}
          placeholder="Масалан: iPhone 15"
        />
      </FilterSection>

      <FilterSection
        title="Нарх диапазони"
        open={getSectionOpen("common.price", true)}
        onToggle={(open) => setSectionOpen("common.price", open)}
      >
        <Slider
          value={priceRange}
          min={minBound}
          max={maxBound}
          onValueChange={(next) => setPriceRange(normalizeRange(next, minBound, maxBound))}
          onValueCommit={(next) => commitPriceRange(normalizeRange(next, minBound, maxBound), true)}
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Input
            type="number"
            min={minBound}
            max={maxBound}
            value={priceRange[0]}
            onChange={(event) => {
              const next = normalizePrice(parseNumberInput(event.target.value, minBound), minBound, priceRange[1]);
              setPriceRange([next, priceRange[1]]);
            }}
            onBlur={() => commitPriceRange(priceRange, false)}
          />
          <Input
            type="number"
            min={minBound}
            max={maxBound}
            value={priceRange[1]}
            onChange={(event) => {
              const next = normalizePrice(parseNumberInput(event.target.value, maxBound), priceRange[0], maxBound);
              setPriceRange([priceRange[0], next]);
            }}
            onBlur={() => commitPriceRange(priceRange, false)}
          />
        </div>

        <p className="mt-2 text-xs font-medium text-accent">
          {formatSum(priceRange[0])} - {formatSum(priceRange[1])}
        </p>
      </FilterSection>

      {renderCheckboxGroup({
        groupKey: "common.delivery_days",
        title: "Етказиб бериш",
        options: COMMON_DELIVERY_OPTIONS,
        selectedValues: value.deliveryDays,
        onToggle: (optionValue) => onChange({ ...value, deliveryDays: toggleInArray(value.deliveryDays, optionValue) }),
        sectionKey: "common.delivery_days",
        defaultOpen: true,
      })}

      <FilterSection
        title="Қўшимча"
        open={getSectionOpen("common.toggles", true)}
        onToggle={(open) => setSectionOpen("common.toggles", open)}
      >
        <div className="space-y-0.5">
          <CheckItem
            label="Фақат мавжудлари"
            checked={value.inStock}
            onChange={() => onChange({ ...value, inStock: !value.inStock })}
          />
          <CheckItem
            label="Фақат чегирмадаги"
            checked={value.hasDiscount}
            onChange={() => onChange({ ...value, hasDiscount: !value.hasDiscount })}
          />
        </div>
      </FilterSection>

      {renderCheckboxGroup({
        groupKey: "common.min_rating",
        title: "Баҳо",
        options: COMMON_MIN_RATING_OPTIONS,
        selectedValues: value.minRating,
        onToggle: (optionValue) => onChange({ ...value, minRating: toggleInArray(value.minRating, optionValue) }),
        sectionKey: "common.min_rating",
        defaultOpen: true,
      })}

      <FilterSection
        title="Брендлар"
        badge={value.brands.length || undefined}
        open={getSectionOpen("common.brand", brands.length < DEFAULT_VISIBLE_CHECKBOX_OPTIONS)}
        onToggle={(open) => setSectionOpen("common.brand", open)}
      >
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={brandSearch}
            onChange={(event) => setBrandSearch(event.target.value)}
            placeholder="Бренд қидириш"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
          {brandOptions.map((brand) => {
            const checked = value.brands.includes(brand.id);
            const disabled = !checked && (brand.count ?? 0) === 0;
            return (
              <CheckItem
                key={brand.id}
                label={brand.name}
                checked={checked}
                count={brand.count}
                disabled={disabled}
                onChange={() => onChange({ ...value, brands: toggleInArray(value.brands, brand.id) })}
              />
            );
          })}
        </div>
      </FilterSection>

      {stores?.length ? (
        <FilterSection
          title="Дўконлар"
          badge={value.stores.length || undefined}
          open={getSectionOpen("common.shop", stores.length < DEFAULT_VISIBLE_CHECKBOX_OPTIONS)}
          onToggle={(open) => setSectionOpen("common.shop", open)}
        >
          <div className="max-h-52 space-y-0.5 overflow-y-auto pr-1">
            {stores.map((store) => {
              const checked = value.stores.includes(store.id);
              const disabled = !checked && (store.count ?? 0) === 0;
              return (
                <CheckItem
                  key={store.id}
                  label={store.name}
                  checked={checked}
                  count={store.count}
                  disabled={disabled}
                  onChange={() => onChange({ ...value, stores: toggleInArray(value.stores, store.id) })}
                />
              );
            })}
          </div>
        </FilterSection>
      ) : null}

      {categoryFilters.map((group) => renderCategoryGroup(group))}
    </div>
  );

  return (
    <>
      <aside className="sticky top-20 hidden self-start md:block">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-bold">Фильтрлар</p>
              {activeCount > 0 ? <p className="text-xs text-accent">{activeCount}</p> : null}
            </div>
            <Button variant="ghost" size="sm" onClick={onReset} className="gap-1.5 text-xs">
              <RotateCcw className="h-3.5 w-3.5" />
              Тозалаш
            </Button>
          </div>
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-3 py-3">{renderPanel()}</div>
        </div>
      </aside>

      <div className="fixed bottom-4 left-4 z-40 md:hidden">
        <Sheet name="catalog-filters" open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button className="gap-2 rounded-full shadow-lg">
              <SlidersHorizontal className="h-4 w-4" />
              Фильтрлар
              {activeCount > 0 ? <span>({activeCount})</span> : null}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[85vh] p-0">
            <div className="flex h-full flex-col">
              <div className="border-b border-border px-5 py-4">
                <p className="font-bold">Фильтрлар</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">{renderPanel()}</div>
              <div className="grid grid-cols-2 gap-2 border-t border-border bg-background p-4">
                <Button variant="outline" onClick={onReset}>
                  Тозалаш
                </Button>
                <Button onClick={() => setMobileOpen(false)}>Қўллаш</Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

function RangeFilterControl({
  min,
  max,
  unit,
  value,
  onChange,
}: {
  min: number;
  max: number;
  unit?: string;
  value: [number, number];
  onChange: (next: [number, number]) => void;
}) {
  const [localRange, setLocalRange] = useState<[number, number]>(value);
  const debounceRef = useRef<number | null>(null);
  const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.1;

  useEffect(() => {
    setLocalRange(value);
  }, [value[0], value[1]]);

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    []
  );

  const normalize = (next: [number, number]): [number, number] => {
    const left = Math.max(min, Math.min(max, next[0]));
    const right = Math.max(min, Math.min(max, next[1]));
    return [Math.min(left, right), Math.max(left, right)];
  };

  const commit = (next: [number, number], delayed: boolean) => {
    const normalized = normalize(next);
    setLocalRange(normalized);

    const apply = () => onChange(normalized);
    if (!delayed) {
      apply();
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(apply, 350);
  };

  return (
    <>
      <Slider
        value={localRange}
        min={min}
        max={max}
        onValueChange={(next) => setLocalRange(normalize([next[0] ?? min, next[1] ?? max]))}
        onValueCommit={(next) => commit(normalize([next[0] ?? min, next[1] ?? max]), true)}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={localRange[0]}
          onChange={(event) => {
            const raw = parseNumberInput(event.target.value, min);
            setLocalRange(normalize([raw, localRange[1]]));
          }}
          onBlur={() => commit(localRange, false)}
        />
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={localRange[1]}
          onChange={(event) => {
            const raw = parseNumberInput(event.target.value, max);
            setLocalRange(normalize([localRange[0], raw]));
          }}
          onBlur={() => commit(localRange, false)}
        />
      </div>

      <p className="mt-2 text-xs font-medium text-accent">
        {formatRangeLabel(localRange[0], unit)} - {formatRangeLabel(localRange[1], unit)}
      </p>
    </>
  );
}

function FilterSection({
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  badge?: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => onToggle(!open)}
        className="flex w-full items-center justify-between py-3 text-left text-sm font-medium transition-colors hover:text-accent"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge ? <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">{badge}</span> : null}
        </span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pb-3">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function CheckItem({
  label,
  checked,
  count,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  count?: number;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      onClick={() => {
        if (!disabled) onChange();
      }}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-secondary/60"}`}
    >
      <span
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${checked ? "border-accent bg-accent" : "border-border bg-background"}`}
      >
        {checked ? (
          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L4 7L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span className={`flex-1 text-sm ${checked ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
      {count !== undefined ? <span className="text-xs text-muted-foreground">{count}</span> : null}
    </label>
  );
}
