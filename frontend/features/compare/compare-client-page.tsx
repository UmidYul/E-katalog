"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, Heart, Search, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/utils/format";
import { COMPARE_LIMIT, type CompareToggleResult, useCompareStore } from "@/store/compare.store";

type CompareSectionKey =
  | "price"
  | "display"
  | "performance"
  | "camera"
  | "battery"
  | "memory"
  | "connectivity"
  | "design"
  | "other";

type CompareProductOffer = {
  shopId: string;
  shopName: string;
  price: number;
  deliveryDays: number | null;
  inStock: boolean;
  url: string | null;
};

type CompareProduct = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  brand: string;
  category: string;
  minPrice: number;
  priceDrop: number;
  offerCount: number;
  offers: CompareProductOffer[];
  bestOfferUrl: string | null;
};

type CompareSpecValue = {
  raw: string | number | null;
  display: string;
};

type CompareSpec = {
  key: string;
  label: string;
  section: CompareSectionKey;
  unit?: string;
  higherIsBetter: boolean;
  values: Record<string, CompareSpecValue>;
};

type CompareResponse = {
  products: CompareProduct[];
  specs: CompareSpec[];
};

type SearchResultItem = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  minPrice: number;
  category: string | null;
};

const STORAGE_KEY = "doxx_compare";
const SWIPE_HINT_STORAGE_KEY = "doxx_compare_hint_seen";

const SECTION_ORDER: Array<{ key: CompareSectionKey; label: string }> = [
  { key: "price", label: "Нархлар" },
  { key: "display", label: "Дисплей" },
  { key: "performance", label: "Унумдорлик" },
  { key: "camera", label: "Камера" },
  { key: "battery", label: "Батарея" },
  { key: "memory", label: "Хотира" },
  { key: "connectivity", label: "Уланиш" },
  { key: "design", label: "Дизайн" },
  { key: "other", label: "Бошқа" },
];

const parseIdsParam = (value: string | null): string[] => {
  if (!value) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rawPart of value.split(",")) {
    const id = rawPart.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= COMPARE_LIMIT) break;
  }
  return ids;
};

const formatPriceWithSum = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${formatPrice(Math.round(value))} сўм`;
};

const parseNumeric = (value: string | number | null | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const getSpecDifference = (spec: CompareSpec, productIds: string[]) => {
  const unique = new Set<string>();
  for (const productId of productIds) {
    const value = spec.values[productId];
    unique.add(String(value?.display ?? "—").trim() || "—");
  }
  return unique.size > 1;
};

const buildOffersMatrix = (products: CompareProduct[]) => {
  const shopMap = new Map<string, string>();
  const valueMap = new Map<string, Record<string, number | null>>();

  for (const product of products) {
    for (const offer of product.offers) {
      if (!offer.shopId) continue;
      shopMap.set(offer.shopId, offer.shopName || "Дўкон");
      const row = valueMap.get(offer.shopId) ?? {};
      const current = row[product.id];
      if (current == null || offer.price < current) row[product.id] = offer.price;
      valueMap.set(offer.shopId, row);
    }
  }

  return Array.from(shopMap.entries())
    .map(([shopId, shopName]) => ({
      shopId,
      shopName,
      values: valueMap.get(shopId) ?? {},
    }))
    .sort((left, right) => left.shopName.localeCompare(right.shopName, "uz-Cyrl"));
};

function SearchModal({
  open,
  exclude,
  onClose,
  onSelect,
}: {
  open: boolean;
  exclude: string[];
  onClose: () => void;
  onSelect: (item: SearchResultItem) => void;
}) {
  const [term, setTerm] = useState("");
  const excludeParam = useMemo(() => exclude.join(","), [exclude]);

  const results = useQuery({
    queryKey: ["compare", "search", term, excludeParam],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (term.trim()) params.set("q", term.trim());
      if (excludeParam) params.set("exclude", excludeParam);
      const response = await fetch(`/api/compare/search?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) return [] as SearchResultItem[];
      return (await response.json()) as SearchResultItem[];
    },
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 md:items-center md:p-4">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-background shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary/50">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold md:text-base">Товар қўшиш</h3>
          <button type="button" className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-secondary" onClick={onClose} aria-label="Ёпиш">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Товар номи ёки модели..." />

          <div className="max-h-[320px] space-y-2 overflow-y-auto">
            {results.isLoading ? (
              <p className="text-sm text-muted-foreground">Қидирилмоқда...</p>
            ) : (results.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Мос товар топилмади.</p>
            ) : (
              (results.data ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left transition hover:border-accent/40 hover:bg-secondary/20"
                >
                  <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-white">
                    {item.image ? (
                      <Image src={item.image} alt={item.name} fill className="object-contain p-1" sizes="48px" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">—</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-accent">дан {formatPriceWithSum(item.minPrice)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyCompare({
  onApplyPreset,
  presets,
}: {
  onApplyPreset: (ids: string[]) => void;
  presets: {
    smartphones: string[];
    laptops: string[];
    loading: boolean;
  };
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center">
        <div className="relative h-14 w-14">
          <div className="absolute left-0 top-1 h-10 w-10 rounded-lg border-2 border-border bg-card" />
          <div className="absolute left-4 top-4 h-10 w-10 rounded-lg border-2 border-accent/60 bg-background" />
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Солиштириш учун товар қўшинг</h1>
        <p className="text-sm text-muted-foreground">Товарлар хусусиятлари ва нархларини бир жойда солиштиринг</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Оммабоп солиштиришлар:</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={presets.loading || presets.smartphones.length < 2}
            onClick={() => onApplyPreset(presets.smartphones)}
            className="rounded-full border border-border px-4 py-2 text-sm transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Топ смартфонлар
          </button>
          <button
            type="button"
            disabled={presets.loading || presets.laptops.length < 2}
            onClick={() => onApplyPreset(presets.laptops)}
            className="rounded-full border border-border px-4 py-2 text-sm transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Ноутбуклар 20 млн гача
          </button>
        </div>
      </div>

      <div>
        <Link href="/catalog">
          <Button>Каталогга ўтиш</Button>
        </Link>
      </div>
    </div>
  );
}

function ProductColumn({
  product,
  onRemove,
  isFavorite,
  onToggleFavorite,
}: {
  product: CompareProduct;
  onRemove: (id: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="relative space-y-2 p-2 text-left">
      <button
        type="button"
        onClick={onToggleFavorite}
        className={cn(
          "absolute left-1 top-1 rounded-full border border-border bg-background p-1",
          isFavorite ? "text-rose-600" : "text-muted-foreground",
        )}
        aria-label="Сараланганларга қўшиш"
      >
        <Heart className={cn("h-3.5 w-3.5", isFavorite && "fill-current")} />
      </button>

      <button
        type="button"
        onClick={() => onRemove(product.id)}
        className="absolute right-1 top-1 rounded-full border border-border bg-background p-1 text-muted-foreground hover:text-foreground"
        aria-label="Олиб ташлаш"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="relative h-[60px] w-[60px] overflow-hidden rounded-lg border border-border bg-white md:h-20 md:w-20">
        {product.image ? (
          <Image src={product.image} alt={product.name} fill className="object-contain p-1.5" sizes="80px" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">—</div>
        )}
      </div>

      <Link href={`/product/${product.slug}`} className="line-clamp-2 text-xs font-medium hover:text-accent md:text-sm">
        {product.name}
      </Link>

      <p className="text-sm font-semibold md:text-base">дан {formatPriceWithSum(product.minPrice)}</p>
      <p className="text-xs text-muted-foreground">{product.offerCount} магазинда</p>

      {product.priceDrop > 0 ? (
        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">↓ {product.priceDrop}%</span>
      ) : null}

      <button
        type="button"
        onClick={() => {
          if (!product.bestOfferUrl) return;
          window.open(product.bestOfferUrl, "_blank", "noopener,noreferrer");
        }}
        disabled={!product.bestOfferUrl}
        className="inline-flex rounded-md border border-border px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Энг яхши нарх →
      </button>
    </div>
  );
}

function SpecRow({
  spec,
  products,
}: {
  spec: CompareSpec;
  products: CompareProduct[];
}) {
  const cells = products.map((product) => spec.values[product.id] ?? { raw: null, display: "—" });
  const uniqueValues = new Set(cells.map((cell) => (String(cell.display).trim() || "—").toLowerCase()));
  const isSame = uniqueValues.size <= 1;

  const numeric = cells
    .map((cell, index) => ({ index, value: parseNumeric(cell.raw) }))
    .filter((item): item is { index: number; value: number } => item.value != null);

  let bestValue: number | null = null;
  let worstValue: number | null = null;
  if (!isSame && numeric.length > 1) {
    bestValue = spec.higherIsBetter
      ? Math.max(...numeric.map((item) => item.value))
      : Math.min(...numeric.map((item) => item.value));
    worstValue = spec.higherIsBetter
      ? Math.min(...numeric.map((item) => item.value))
      : Math.max(...numeric.map((item) => item.value));
  }

  return (
    <tr className="group border-t border-border hover:bg-secondary/20">
      <td className="sticky left-0 z-[5] bg-background px-3 py-2 text-xs font-medium md:text-sm">{spec.label}</td>
      {cells.map((cell, index) => {
        const numericValue = parseNumeric(cell.raw);
        const display = String(cell.display || "—");
        const isMissing = display === "—" || !display.trim();
        const isBest = bestValue != null && numericValue != null && Math.abs(numericValue - bestValue) < 1e-9;
        const isWorst =
          worstValue != null &&
          numericValue != null &&
          Math.abs(numericValue - worstValue) < 1e-9 &&
          products.length > 1;

        return (
          <td
            key={`${spec.key}-${products[index]?.id ?? index}`}
            className={cn(
              "px-3 py-2 text-xs md:text-sm",
              (isSame || isMissing || isWorst) && "text-muted-foreground",
              isBest && "font-medium text-emerald-600",
            )}
          >
            {display}
            {spec.unit && !display.includes(spec.unit) && display !== "—" ? ` ${spec.unit}` : ""}
          </td>
        );
      })}
    </tr>
  );
}

function CompareVerdict({
  products,
  specs,
}: {
  products: CompareProduct[];
  specs: CompareSpec[];
}) {
  const verdict = useMemo(() => {
    if (products.length < 2) return [];

    const wins = new Map<string, string[]>();
    for (const product of products) wins.set(product.id, []);

    const validPrices = products.filter((product) => product.minPrice > 0);
    if (validPrices.length >= 2) {
      const bestPrice = Math.min(...validPrices.map((product) => product.minPrice));
      for (const product of validPrices) {
        if (product.minPrice === bestPrice) wins.get(product.id)?.push(`нарх (${formatPriceWithSum(product.minPrice)})`);
      }
    }

    for (const spec of specs) {
      if (spec.section === "price") continue;
      const numericValues = products
        .map((product) => {
          const value = spec.values[product.id];
          return {
            productId: product.id,
            raw: parseNumeric(value?.raw),
            display: value?.display ?? "—",
          };
        })
        .filter((item): item is { productId: string; raw: number; display: string } => item.raw != null);

      if (numericValues.length < 2) continue;
      const unique = new Set(numericValues.map((item) => item.raw));
      if (unique.size <= 1) continue;

      const best = spec.higherIsBetter
        ? Math.max(...numericValues.map((item) => item.raw))
        : Math.min(...numericValues.map((item) => item.raw));
      for (const item of numericValues) {
        if (Math.abs(item.raw - best) < 1e-9) {
          wins.get(item.productId)?.push(`${spec.label} (${item.display})`);
        }
      }
    }

    return products
      .map((product) => ({
        product,
        wins: (wins.get(product.id) ?? []).slice(0, 5),
      }))
      .filter((item) => item.wins.length > 0);
  }, [products, specs]);

  if (products.length < 2 || verdict.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">Хулоса</h2>
      <div className="space-y-2">
        {verdict.map((item) => (
          <p key={item.product.id} className="text-sm">
            <span className="font-semibold">{item.product.name}:</span> {item.wins.join(", ")}
          </p>
        ))}
      </div>
    </section>
  );
}

export function CompareClientPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const compareItems = useCompareStore((state) => state.items);
  const add = useCompareStore((state) => state.add);
  const remove = useCompareStore((state) => state.remove);
  const clear = useCompareStore((state) => state.clear);
  const replace = useCompareStore((state) => state.replace);
  const favoritesQuery = useFavorites();
  const toggleFavorite = useToggleFavorite();

  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);

  const idsFromUrl = useMemo(() => parseIdsParam(searchParams.get("ids")), [searchParams]);
  const currentIds = useMemo(() => compareItems.map((item) => item.id).slice(0, COMPARE_LIMIT), [compareItems]);
  const currentIdsHash = useMemo(() => currentIds.join(","), [currentIds]);
  const urlIdsHash = useMemo(() => idsFromUrl.join(","), [idsFromUrl]);

  const hydrateFromIds = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const query = ids.join(",");
      try {
        const response = await fetch(`/api/compare?ids=${query}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as CompareResponse;
        const items = (data.products ?? []).slice(0, COMPARE_LIMIT).map((product) => ({
          id: product.id,
          title: product.name,
          slug: product.slug,
          category: product.category,
          image: product.image ?? undefined,
        }));
        replace(items);
      } catch {
        // ignore hydration errors
      }
    },
    [replace],
  );

  useEffect(() => {
    if (isBootstrapped) return;
    const bootstrap = async () => {
      if (idsFromUrl.length) {
        await hydrateFromIds(idsFromUrl);
      } else {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const parsed = JSON.parse(raw ?? "[]") as unknown;
          const storedArray = Array.isArray(parsed) ? parsed : [];
          const stored = parseIdsParam(storedArray.map((item) => String(item)).join(","));
          if (stored.length) await hydrateFromIds(stored);
        } catch {
          // ignore storage errors
        }
      }
      setIsBootstrapped(true);
    };
    void bootstrap();
  }, [hydrateFromIds, idsFromUrl, isBootstrapped]);

  useEffect(() => {
    if (!isBootstrapped || !urlIdsHash) return;
    if (urlIdsHash === currentIdsHash) return;
    void hydrateFromIds(idsFromUrl);
  }, [currentIdsHash, hydrateFromIds, idsFromUrl, isBootstrapped, urlIdsHash]);

  useEffect(() => {
    if (!isBootstrapped) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentIds));
    } catch {
      // ignore storage errors
    }

    const currentParam = String(searchParams.get("ids") ?? "");
    if (currentParam === currentIdsHash) return;
    const nextUrl = currentIdsHash ? `${pathname}?ids=${currentIdsHash}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [currentIds, currentIdsHash, isBootstrapped, pathname, router, searchParams]);

  useEffect(() => {
    if (!isBootstrapped || currentIds.length < 2) return;
    if (window.innerWidth >= 768) return;
    try {
      const seen = localStorage.getItem(SWIPE_HINT_STORAGE_KEY);
      if (!seen) setShowSwipeHint(true);
    } catch {
      setShowSwipeHint(true);
    }
  }, [currentIds.length, isBootstrapped]);

  const compareQuery = useQuery({
    queryKey: ["compare", currentIdsHash],
    queryFn: async () => {
      const response = await fetch(`/api/compare?ids=${currentIdsHash}`, { cache: "no-store" });
      if (!response.ok) return { products: [], specs: [] } satisfies CompareResponse;
      return (await response.json()) as CompareResponse;
    },
    enabled: currentIds.length > 0,
    staleTime: 30_000,
  });

  const presetSmartphones = useQuery({
    queryKey: ["compare", "preset", "smartphones"],
    queryFn: async () => {
      const response = await fetch("/api/compare/preset?kind=smartphones_top", { cache: "no-store" });
      if (!response.ok) return [] as string[];
      const data = (await response.json()) as { ids?: string[] };
      return parseIdsParam((data.ids ?? []).join(","));
    },
    enabled: currentIds.length === 0,
    staleTime: 60_000,
  });

  const presetLaptops = useQuery({
    queryKey: ["compare", "preset", "laptops"],
    queryFn: async () => {
      const response = await fetch("/api/compare/preset?kind=laptops_20m", { cache: "no-store" });
      if (!response.ok) return [] as string[];
      const data = (await response.json()) as { ids?: string[] };
      return parseIdsParam((data.ids ?? []).join(","));
    },
    enabled: currentIds.length === 0,
    staleTime: 60_000,
  });

  const products = useMemo(() => {
    const byId = new Map((compareQuery.data?.products ?? []).map((product) => [product.id, product]));
    return currentIds.map((id) => byId.get(id)).filter((product): product is CompareProduct => Boolean(product));
  }, [compareQuery.data?.products, currentIds]);
  const favoriteSet = useMemo(
    () => new Set((favoritesQuery.data ?? []).map((item) => item.product_id)),
    [favoritesQuery.data],
  );

  const specs = useMemo(() => compareQuery.data?.specs ?? [], [compareQuery.data?.specs]);

  const sections = useMemo(() => {
    const productIds = products.map((product) => product.id);
    return SECTION_ORDER.map((section) => {
      const rows = specs
        .filter((spec) => spec.section === section.key && section.key !== "price")
        .map((spec) => ({
          ...spec,
          isDifferent: getSpecDifference(spec, productIds),
        }))
        .filter((spec) => !showDiffOnly || spec.isDifferent);
      return {
        ...section,
        rows,
      };
    }).filter((section) => section.key === "price" || section.rows.length > 0);
  }, [products, showDiffOnly, specs]);

  const offersRows = useMemo(() => buildOffersMatrix(products), [products]);

  const addProduct = useCallback(
    (item: SearchResultItem) => {
      const result = add({
        id: item.id,
        title: item.name,
        slug: item.slug,
        category: item.category ?? undefined,
        image: item.image ?? undefined,
      });
      const showAddResultToast = (value: CompareToggleResult) => {
        if (value === "limit_reached") toast.error("Энг кўпи 4 та товар солиштириш мумкин.");
        if (value === "already_added") toast.info("Бу товар аллақачон қўшилган.");
        if (value === "category_mismatch") toast.error("Бир хил категориядаги товарлар солиштирилади.");
      };
      showAddResultToast(result);
      if (result === "added") setSearchModalOpen(false);
    },
    [add],
  );

  const applyPreset = useCallback(
    async (ids: string[]) => {
      if (ids.length < 2) return;
      await hydrateFromIds(ids.slice(0, COMPARE_LIMIT));
    },
    [hydrateFromIds],
  );

  const copyShareLink = useCallback(async () => {
    if (!currentIds.length) return;
    try {
      const response = await fetch(`/api/compare/share?ids=${currentIds.join(",")}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({ url: `/compare?ids=${currentIds.join(",")}` }))) as { url?: string };
      const sharePath = payload.url ?? `/compare?ids=${currentIds.join(",")}`;
      const full = `${window.location.origin}${sharePath}`;
      await navigator.clipboard.writeText(full);
      toast.success("Ҳавола нусхаланди ✓");
    } catch {
      toast.error("Ҳаволани нусхалашда хатолик.");
    }
  }, [currentIds]);

  if (!isBootstrapped && currentIds.length === 0) {
    return <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">Солиштириш юкланмоқда...</div>;
  }

  if (currentIds.length === 0) {
    return (
      <EmptyCompare
        onApplyPreset={applyPreset}
        presets={{
          smartphones: presetSmartphones.data ?? [],
          laptops: presetLaptops.data ?? [],
          loading: presetSmartphones.isLoading || presetLaptops.isLoading,
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 py-4 md:px-4 md:py-6">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-1 py-2">
        <h1 className="text-lg font-semibold md:text-xl">Солиштириш</h1>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">{currentIds.length} товар</span>
        <span className="flex-1" />

        <label className="hidden items-center gap-2 text-sm md:inline-flex">
          <input type="checkbox" checked={showDiffOnly} onChange={(event) => setShowDiffOnly(event.target.checked)} className="h-4 w-4 rounded border-border" />
          Фақат фарқлар
        </label>

        <Button variant="ghost" size="sm" className="gap-1.5" onClick={copyShareLink}>
          Улашиш <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={clear}>
          Тозалаш
        </Button>
      </div>

      <div className="sticky top-[54px] z-20 w-fit md:hidden">
        <button
          type="button"
          onClick={() => setShowDiffOnly((current) => !current)}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium",
            showDiffOnly ? "border-accent bg-accent text-white" : "border-border bg-background",
          )}
        >
          Фақат фарқлар
        </button>
      </div>

      {showSwipeHint ? (
        <div className="md:hidden rounded-lg border border-accent/20 bg-accent/10 px-3 py-2 text-xs text-accent">
          <div className="flex items-center justify-between gap-2">
            <span>← Ўнгга суринг</span>
            <button
              type="button"
              onClick={() => {
                setShowSwipeHint(false);
                try {
                  localStorage.setItem(SWIPE_HINT_STORAGE_KEY, "1");
                } catch {
                  // ignore storage errors
                }
              }}
              className="rounded border border-accent/30 px-1.5 py-0.5 text-[10px]"
            >
              Тушунарли
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] border-collapse">
          <thead className="sticky top-[48px] z-10 bg-background">
            <tr className="border-b border-border align-top">
              <th className="sticky left-0 z-[15] w-40 min-w-40 bg-background px-3 py-2 text-left text-xs font-semibold md:text-sm">Хусусият</th>
              {products.map((product) => (
                <th key={product.id} className="w-44 min-w-[220px] border-l border-border bg-background">
                  <ProductColumn
                    product={product}
                    onRemove={remove}
                    isFavorite={favoriteSet.has(product.id)}
                    onToggleFavorite={() =>
                      toggleFavorite.mutate({
                        productId: product.id,
                        currentPrice: product.minPrice,
                      })
                    }
                  />
                </th>
              ))}
              {currentIds.length < COMPARE_LIMIT ? (
                <th className="w-44 min-w-[220px] border-l border-border bg-background p-2">
                  <button
                    type="button"
                    onClick={() => setSearchModalOpen(true)}
                    className="flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-muted-foreground transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-500"
                  >
                    <span className="text-3xl">+</span>
                    <span className="text-sm">Товар қўшиш</span>
                  </button>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const columnCount = products.length + (currentIds.length < COMPARE_LIMIT ? 2 : 1);
              if (section.key === "price") {
                return (
                  <FragmentSection key={section.key} label={section.label} columnCount={columnCount}>
                    {offersRows.map((offerRow) => {
                      const availablePrices = products
                        .map((product) => offerRow.values[product.id] ?? null)
                        .filter((value): value is number => value != null && value > 0);
                      const best = availablePrices.length ? Math.min(...availablePrices) : null;
                      return (
                        <tr key={offerRow.shopId} className="group border-t border-border hover:bg-secondary/20">
                          <td className="sticky left-0 z-[5] bg-background px-3 py-2 text-xs font-medium md:text-sm">{offerRow.shopName}</td>
                          {products.map((product) => {
                            const price = offerRow.values[product.id] ?? null;
                            const isBest = best != null && price != null && price === best;
                            return (
                              <td key={`${offerRow.shopId}-${product.id}`} className={cn("px-3 py-2 text-xs md:text-sm", !price && "text-muted-foreground", isBest && "font-medium text-emerald-600")}>
                                {price ? formatPriceWithSum(price) : "—"}
                              </td>
                            );
                          })}
                          {currentIds.length < COMPARE_LIMIT ? <td className="px-3 py-2" /> : null}
                        </tr>
                      );
                    })}

                    <tr className="border-t border-border">
                      <td className="sticky left-0 z-[5] bg-background px-3 py-2 text-xs font-medium md:text-sm">Барча таклифлар</td>
                      {products.map((product) => (
                        <td key={`offers-link-${product.id}`} className="px-3 py-2">
                          <Link href={`/product/${product.slug}#offers`} className="inline-flex rounded-md border border-border px-2 py-1 text-xs text-accent hover:bg-accent/10">
                            Барча таклифлар →
                          </Link>
                        </td>
                      ))}
                      {currentIds.length < COMPARE_LIMIT ? <td className="px-3 py-2" /> : null}
                    </tr>
                  </FragmentSection>
                );
              }

              return (
                <FragmentSection key={section.key} label={section.label} columnCount={columnCount}>
                  {section.rows.map((spec) => (
                    <SpecRow key={spec.key} spec={spec} products={products} />
                  ))}
                </FragmentSection>
              );
            })}
          </tbody>
        </table>
      </div>

      <CompareVerdict products={products} specs={specs} />

      <SearchModal
        open={searchModalOpen}
        exclude={currentIds}
        onClose={() => setSearchModalOpen(false)}
        onSelect={(item) => addProduct(item)}
      />
    </div>
  );
}

function FragmentSection({
  label,
  columnCount,
  children,
}: {
  label: string;
  columnCount: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr className="border-t border-border bg-secondary/30">
        <td colSpan={columnCount} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </td>
      </tr>
      {children}
    </>
  );
}
