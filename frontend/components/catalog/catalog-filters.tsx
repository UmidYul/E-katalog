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
  brands: number[];
  stores: number[];
  sellers: number[];
  minPrice?: number;
  maxPrice?: number;
  maxDeliveryDays?: number;
  attrs?: Record<string, string[]>;
};

export function CatalogFilters({
  brands,
  stores,
  sellers,
  dynamicAttributes,
  value,
  onChange
}: {
  brands: Array<{ id: number; name: string }>;
  stores?: Array<{ id: number; name: string }>;
  sellers?: Array<{ id: number; name: string }>;
  dynamicAttributes?: Array<{ key: string; label: string; values: Array<{ value: string; label: string; count?: number }> }>;
  value: FilterState;
  onChange: (v: FilterState) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([value.minPrice ?? 0, value.maxPrice ?? 100_000_000]);

  useEffect(() => {
    setPriceRange([value.minPrice ?? 0, value.maxPrice ?? 100_000_000]);
  }, [value.maxPrice, value.minPrice]);

  const priceLabel = useMemo(() => `${priceRange[0].toLocaleString()} - ${priceRange[1].toLocaleString()} UZS`, [priceRange]);

  const panel = (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Search</label>
        <Input value={value.q ?? ""} onChange={(e) => onChange({ ...value, q: e.target.value || undefined })} placeholder="Search models..." />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Sort</label>
        <Select value={value.sort} onValueChange={(next) => onChange({ ...value, sort: next as FilterState["sort"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Popular</SelectItem>
            <SelectItem value="relevance">Relevance</SelectItem>
            <SelectItem value="price_asc">Price low-high</SelectItem>
            <SelectItem value="price_desc">Price high-low</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Price Range</label>
        <Slider
          value={priceRange}
          min={0}
          max={100_000_000}
          onValueChange={(next) => {
            const normalized: [number, number] = [Math.min(next[0] ?? 0, next[1] ?? 100_000_000), Math.max(next[0] ?? 0, next[1] ?? 100_000_000)];
            setPriceRange(normalized);
            onChange({ ...value, minPrice: normalized[0], maxPrice: normalized[1] });
          }}
        />
        <p className="text-xs text-muted-foreground">{priceLabel}</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Brands</label>
        <div className="space-y-2">
          {brands.map((brand) => {
            const active = value.brands.includes(brand.id);
            return (
              <label key={brand.id} className="flex cursor-pointer items-center gap-2 text-sm">
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
          <label className="text-sm font-medium">Stores</label>
          <div className="space-y-2">
            {stores.map((store) => {
              const active = value.stores.includes(store.id);
              return (
                <label key={store.id} className="flex cursor-pointer items-center gap-2 text-sm">
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
          <label className="text-sm font-medium">Sellers</label>
          <div className="space-y-2">
            {sellers.slice(0, 20).map((seller) => {
              const active = value.sellers.includes(seller.id);
              return (
                <label key={seller.id} className="flex cursor-pointer items-center gap-2 text-sm">
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
        <label className="text-sm font-medium">Max Delivery Days</label>
        <Input
          type="number"
          min={0}
          max={30}
          value={value.maxDeliveryDays ?? ""}
          onChange={(e) => onChange({ ...value, maxDeliveryDays: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="Any"
        />
      </div>

      {dynamicAttributes?.map((attribute) => (
        <div key={attribute.key} className="space-y-2">
          <label className="text-sm font-medium">{attribute.label}</label>
          <div className="space-y-2">
            {attribute.values.map((option) => {
              const selected = value.attrs?.[attribute.key]?.includes(option.value) ?? false;
              return (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const current = value.attrs?.[attribute.key] ?? [];
                      const nextValues = selected ? current.filter((v) => v !== option.value) : [...current, option.value];
                      onChange({
                        ...value,
                        attrs: { ...(value.attrs ?? {}), [attribute.key]: nextValues }
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
      <aside className="hidden rounded-2xl border border-border bg-card p-4 lg:block">{panel}</aside>
      <div className="lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> Filters
            </Button>
          </SheetTrigger>
          <SheetContent>{panel}</SheetContent>
        </Sheet>
      </div>
    </>
  );
}

