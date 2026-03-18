"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  CreditCard,
  ExternalLink,
  Heart,
  Landmark,
  Scale,
  Truck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Breadcrumb } from "@/components/common/breadcrumbs";
import { EmptyState } from "@/components/common/empty-state";
import { ProductGallery } from "@/components/product/product-gallery";
import { ProductPageSkeleton } from "@/components/product/product-page-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StarRating } from "@/components/ui/star-rating";
import { useAuthMe } from "@/features/auth/use-auth";
import type {
  ProductPageData,
  ProductPriceHistoryPoint,
  ProductVariantGroup,
  SimilarProductItem,
} from "@/features/product/product-types";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { productFeedbackApi } from "@/lib/api/openapi-client";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatPrice, formatRelativeTime } from "@/lib/utils/format";
import { useCompareStore } from "@/store/compare.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";
import type { ProductReview } from "@/types/domain";

type ProductClientPageProps = {
  initialProduct: ProductPageData;
};

type HistoryPeriod = "7d" | "30d" | "90d" | "all";
type ProductTab = "specs" | "reviews" | "history" | "similar";
type ReviewFilter = "all" | "positive" | "negative" | "photo";

const HISTORY_OPTIONS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: "7d", label: "7 кун" },
  { value: "30d", label: "30 кун" },
  { value: "90d", label: "90 кун" },
  { value: "all", label: "Барча вақт" },
];

const formatPriceWithSum = (value: number) => `${formatPrice(value)} сўм`;

const toInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";

const offerCountLabel = (count: number) => (count === 1 ? "дўкон" : "дўкон");

const resolveTabFromHash = (hash: string): ProductTab | null => {
  const normalized = hash.replace("#", "");
  if (normalized === "specs" || normalized === "reviews" || normalized === "history" || normalized === "similar") {
    return normalized;
  }
  return null;
};

const formatWeekLabel = (isoDate: string) => {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;

  const dayFromMonday = (parsed.getUTCDay() + 6) % 7;
  const weekStart = new Date(parsed);
  weekStart.setUTCDate(parsed.getUTCDate() - dayFromMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  const from = weekStart.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  const to = weekEnd.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  return `${from} – ${to}`;
};

const getWeekKey = (isoDate: string) => {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;

  const dayFromMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - dayFromMonday);
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildSpecSections = (specs: Record<string, string>) => {
  const groups = {
    display: [] as Array<{ key: string; label: string; value: string }>,
    processor: [] as Array<{ key: string; label: string; value: string }>,
    camera: [] as Array<{ key: string; label: string; value: string }>,
    memory: [] as Array<{ key: string; label: string; value: string }>,
    network: [] as Array<{ key: string; label: string; value: string }>,
    other: [] as Array<{ key: string; label: string; value: string }>,
  };

  Object.entries(specs).forEach(([key, value]) => {
    const normalized = key.toLowerCase();
    const row = {
      key,
      label: key.replace(/_/g, " "),
      value,
    };

    if (/(display|screen|resolution|refresh)/i.test(normalized)) {
      groups.display.push(row);
      return;
    }
    if (/(cpu|gpu|chip|processor)/i.test(normalized)) {
      groups.processor.push(row);
      return;
    }
    if (/camera/i.test(normalized)) {
      groups.camera.push(row);
      return;
    }
    if (/(ram|storage|memory)/i.test(normalized)) {
      groups.memory.push(row);
      return;
    }
    if (/(network|wifi|bluetooth|sim|gps)/i.test(normalized)) {
      groups.network.push(row);
      return;
    }
    groups.other.push(row);
  });

  const titledSections: Array<{ title: string; rows: Array<{ key: string; label: string; value: string }> }> = [
    { title: "Дисплей", rows: groups.display },
    { title: "Процессор", rows: groups.processor },
    { title: "Камера", rows: groups.camera },
    { title: "Хотира", rows: groups.memory },
    { title: "Алоқа", rows: groups.network },
    { title: "Бошқа", rows: groups.other },
  ];

  return titledSections.filter((section) => section.rows.length > 0);
};

const filterReviews = (reviews: ProductReview[], filter: ReviewFilter) => {
  if (filter === "positive") return reviews.filter((review) => review.rating >= 4);
  if (filter === "negative") return reviews.filter((review) => review.rating <= 2);
  if (filter === "photo") return reviews.filter(() => false);
  return reviews;
};

const paymentChip = (key: "card" | "cash" | "installment") => {
  if (key === "card") return { icon: CreditCard, label: "Карта" };
  if (key === "cash") return { icon: Landmark, label: "Нақд" };
  return { icon: BarChart3, label: "0%" };
};

function PriceAlertButton({ product }: { product: ProductPageData }) {
  const me = useAuthMe();
  const [open, setOpen] = useState(false);
  const [targetPrice, setTargetPrice] = useState("");
  const [contact, setContact] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);

  const submitAlert = async () => {
    const parsedTarget = Number(targetPrice.replace(/\s+/g, ""));
    setPending(true);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          currentPrice: product.minPrice,
          targetPrice: Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : null,
          contact: me.data?.id ? null : contact.trim(),
        }),
      });

      if (!response.ok) throw new Error("alert_error");
      setSuccess(true);
    } catch {
      setSuccess(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => setOpen(true)}>
        <Bell className="h-4 w-4" /> Нарх тушса хабар беринг
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSuccess(false);
        }}
        title="Нарх огоҳлантириши"
      >
        {success ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            ✓ Нарх пасайганда сизга хабар берамиз.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-secondary/20 p-3 text-sm">
              Жорий нарх: <strong>{formatPriceWithSum(product.minPrice)}</strong>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Қайси нархдан паст бўлса хабар бериш</label>
              <Input
                value={targetPrice}
                onChange={(event) => setTargetPrice(event.target.value)}
                placeholder="Масалан: 11 500 000"
              />
            </div>
            {!me.data?.id ? (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Email ёки телефон</label>
                <Input
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  placeholder="email@example.com ёки +998..."
                />
              </div>
            ) : null}
            <Button onClick={submitAlert} disabled={pending || (!me.data?.id && !contact.trim())}>
              {pending ? "Сақланмоқда..." : "Огоҳлантиришни ёқиш"}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}

function VariantSelector({
  variants,
  value,
  onChange,
}: {
  variants: ProductVariantGroup[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  if (!variants.length) return null;

  return (
    <div className="space-y-2">
      {variants.map((group) => (
        <div key={group.key} className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{group.label}</p>
          <div className="flex flex-wrap gap-2">
            {group.values.map((option) => {
              const active = value[group.key] === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onChange({ ...value, [group.key]: option })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    active ? "border-accent bg-accent text-white" : "border-border",
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function OffersPanel({
  product,
  offers,
  offersRef,
}: {
  product: ProductPageData;
  offers: ProductPageData["offers"];
  offersRef?: RefObject<HTMLDivElement>;
}) {
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? offers : offers.slice(0, 3);

  const openOffer = (offer: ProductPageData["offers"][number]) => {
    if (!offer.url) return;

    const payload = {
      productId: product.id,
      offerId: offer.id,
      shopId: offer.shopId,
      timestamp: new Date().toISOString(),
    };

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        navigator.sendBeacon("/api/clicks", blob);
      } else {
        void fetch("/api/clicks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    } catch {
      // ignore tracking failures
    }

    window.open(offer.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div ref={offersRef} className="space-y-3 md:sticky md:top-4">
      <h3 className="text-lg font-semibold">Дўкон таклифлари</h3>
      {list.map((offer, index) => (
        <article
          key={offer.id}
          className={cn(
            "space-y-2 rounded-xl border border-border bg-card p-3",
            index === 0 && "border-emerald-300",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                {offer.shopName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <p className="text-sm font-medium">{offer.shopName}</p>
                {index === 0 ? <p className="text-xs text-emerald-600">🏆 Энг яхши нарх</p> : null}
              </div>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold">{formatPriceWithSum(offer.price)}</p>
              {offer.oldPrice && offer.oldPrice > offer.price ? (
                <p className="text-xs text-muted-foreground line-through">{formatPriceWithSum(offer.oldPrice)}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary/30 px-2 py-0.5">
              <Truck className="h-3 w-3" />
              {offer.deliveryDays === 0 ? "Бугун" : `${offer.deliveryDays ?? 1} кунда`}
            </span>
            {offer.paymentMethods.map((method) => {
              const meta = paymentChip(method);
              const Icon = meta.icon;
              return (
                <span key={`${offer.id}-${method}`} className="inline-flex items-center gap-1 rounded-full bg-secondary/30 px-2 py-0.5">
                  <Icon className="h-3 w-3" /> {meta.label}
                </span>
              );
            })}
            <span
              className={cn(
                "rounded-full px-2 py-0.5",
                offer.inStock ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
              )}
            >
              {offer.inStock ? "Мавжуд" : "Буюртма асосида"}
            </span>
          </div>

          <Button type="button" size="sm" className="w-full justify-center gap-1" onClick={() => openOffer(offer)}>
            Дўконга ўтиш <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </article>
      ))}

      {offers.length > 3 ? (
        <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setShowAll((current) => !current)}>
          {showAll ? "Қисқартириш" : `+ яна ${offers.length - 3} та таклиф`}
        </button>
      ) : null}

      {product.lastUpdated ? <p className="text-xs text-muted-foreground">Нархлар янгиланди: {formatRelativeTime(product.lastUpdated)}</p> : null}
    </div>
  );
}

function ProductTabs({
  product,
  similar,
  isAuthenticated,
}: {
  product: ProductPageData;
  similar: SimilarProductItem[];
  isAuthenticated: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ProductTab>("specs");
  const [specsExpanded, setSpecsExpanded] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>("30d");

  const reviewsQuery = useQuery({
    queryKey: ["product", product.id, "reviews"],
    queryFn: () => productFeedbackApi.listReviews(product.id, { limit: 60, offset: 0 }),
    staleTime: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ["product", product.id, "history", historyPeriod],
    queryFn: async () => {
      const response = await fetch(`/api/products/${product.id}/price-history?period=${historyPeriod}&shopId=all`, { cache: "no-store" });
      if (!response.ok) return [] as ProductPriceHistoryPoint[];
      return (await response.json()) as ProductPriceHistoryPoint[];
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    const syncFromHash = () => {
      const tab = resolveTabFromHash(window.location.hash);
      if (tab) setActiveTab(tab);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const switchTab = (tab: ProductTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, "", `#${tab}`);
  };

  const specsSections = useMemo(() => buildSpecSections(product.specs), [product.specs]);
  const reviews = reviewsQuery.data ?? [];
  const filteredReviews = useMemo(() => filterReviews(reviews, reviewFilter), [reviews, reviewFilter]);

  const averageRating = reviews.length
    ? Number((reviews.reduce((acc, review) => acc + Number(review.rating || 0), 0) / reviews.length).toFixed(1))
    : 0;

  const histogram = useMemo(() => {
    const total = Math.max(reviews.length, 1);
    return [5, 4, 3, 2, 1].map((star) => {
      const count = reviews.filter((review) => review.rating === star).length;
      return {
        star,
        count,
        percent: Math.round((count / total) * 100),
      };
    });
  }, [reviews]);

  const historyPoints = historyQuery.data ?? [];
  const shopNames = useMemo(() => Array.from(new Set(historyPoints.map((point) => point.shopName))), [historyPoints]);
  const [enabledShops, setEnabledShops] = useState<string[]>([]);

  useEffect(() => {
    setEnabledShops(shopNames);
  }, [shopNames.join("|")]);

  const chartData = useMemo(() => {
    const grouped = new Map<string, Record<string, number | string>>();
    historyPoints.forEach((point) => {
      if (!enabledShops.includes(point.shopName)) return;
      const row = grouped.get(point.date) ?? { date: point.date };
      row[point.shopName] = point.price;
      grouped.set(point.date, row);
    });
    return Array.from(grouped.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [enabledShops, historyPoints]);

  const historyMin = historyPoints.length ? Math.min(...historyPoints.map((point) => point.price)) : 0;
  const historyMax = historyPoints.length ? Math.max(...historyPoints.map((point) => point.price)) : 0;
  const historyCurrent = historyPoints.length ? historyPoints[historyPoints.length - 1]?.price ?? 0 : 0;

  const weeklySummary = useMemo(() => {
    const byWeekAndShop = new Map<string, { weekKey: string; weekLabel: string; shop: string; price: number }>();
    historyPoints.forEach((point) => {
      const weekKey = getWeekKey(point.date);
      const key = `${weekKey}|${point.shopName}`;
      const current = byWeekAndShop.get(key);
      if (current == null || point.price < current.price) {
        byWeekAndShop.set(key, {
          weekKey,
          weekLabel: formatWeekLabel(point.date),
          shop: point.shopName,
          price: point.price,
        });
      }
    });
    return Array.from(byWeekAndShop.values()).sort((left, right) => {
      if (left.weekKey === right.weekKey) return left.shop.localeCompare(right.shop);
      return right.weekKey.localeCompare(left.weekKey);
    });
  }, [historyPoints]);

  const tabs: Array<{ key: ProductTab; label: string; hidden?: boolean }> = [
    { key: "specs", label: "Хусусиятлар" },
    { key: "reviews", label: "Фикрлар" },
    { key: "history", label: "Нарх тарихи" },
    { key: "similar", label: "Ўхшашлар", hidden: similar.length === 0 },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {tabs.filter((tab) => !tab.hidden).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => switchTab(tab.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm transition-colors",
              activeTab === tab.key ? "bg-accent text-white" : "bg-secondary/30 text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "specs" ? (
        <div id="specs" className="space-y-4">
          {specsSections.map((section) => {
            const visibleRows = specsExpanded ? section.rows : section.rows.slice(0, 8);
            return (
              <div key={section.title} className="space-y-2">
                <h3 className="text-base font-semibold">{section.title}</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {visibleRows.map((row, index) => (
                    <div key={`${section.title}-${row.key}`} className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg px-3 py-2 text-sm", index % 2 === 0 ? "bg-secondary/20" : "bg-secondary/40")}>
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="font-medium">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {Object.keys(product.specs).length > 8 ? (
            <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setSpecsExpanded((current) => !current)}>
              {specsExpanded ? "Йиғиш" : `Барчасини кўриш (${Object.keys(product.specs).length} параметр)`}
            </button>
          ) : null}
        </div>
      ) : null}

      {activeTab === "reviews" ? (
        <div id="reviews" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <StarRating value={averageRating} readonly />
              <span className="text-lg font-semibold">{averageRating.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">{reviews.length} та фикр</span>
            </div>

            <div className="mt-3 space-y-1">
              {histogram.map((row) => (
                <div key={row.star} className="grid grid-cols-[32px_minmax(0,1fr)_48px] items-center gap-2 text-xs">
                  <span>{row.star}★</span>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${row.percent}%` }} />
                  </div>
                  <span className="text-muted-foreground">{row.percent}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {[
                { key: "all", label: "Барчаси" },
                { key: "positive", label: "Ижобий" },
                { key: "negative", label: "Салбий" },
                { key: "photo", label: "Расмли" },
              ].map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setReviewFilter(chip.key as ReviewFilter)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm",
                    reviewFilter === chip.key ? "border-accent bg-accent text-white" : "border-border",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <Link
              href={isAuthenticated ? "#reviews" : "/login"}
              className="rounded-md border border-accent/30 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10"
            >
              Фикр ёзиш
            </Link>
          </div>

          {filteredReviews.length === 0 ? (
            <EmptyState icon={<span className="text-2xl">💬</span>} title="Биринчи фикрни сиз қолдиринг" />
          ) : (
            <div className="space-y-3">
              {filteredReviews.map((review) => (
                <article key={review.id} className="space-y-2 rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                        {toInitials(review.author)}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{review.author}</p>
                        <div className="flex items-center gap-1">
                          <StarRating value={review.rating} readonly size="sm" />
                          <span className="text-xs text-muted-foreground">{formatDateTime(review.created_at, "uz-Cyrl-UZ", { dateStyle: "medium" })}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">👍 {review.helpful_votes ?? 0}</span>
                  </div>
                  <p className="text-sm leading-6">{review.comment}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "history" ? (
        <div id="history" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {HISTORY_OPTIONS.map((period) => (
              <button
                key={period.value}
                type="button"
                onClick={() => setHistoryPeriod(period.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  historyPeriod === period.value ? "border-accent bg-accent text-white" : "border-border",
                )}
              >
                {period.label}
              </button>
            ))}
          </div>

          {historyQuery.isLoading ? (
            <div className="h-64 animate-pulse rounded-xl border border-border bg-secondary/20" />
          ) : historyPoints.length === 0 ? (
            <EmptyState icon={<span className="text-2xl">📉</span>} title="Нарх тарихи ҳали мавжуд эмас" />
          ) : (
            <>
              <div className="h-72 rounded-xl border border-border bg-card p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => formatPrice(Number(value))} tick={{ fontSize: 11 }} width={84} />
                    <Tooltip formatter={(value: number | string) => formatPriceWithSum(Number(value))} />
                    {shopNames
                      .filter((shop) => enabledShops.includes(shop))
                      .map((shop, index) => (
                        <Line
                          key={shop}
                          type="monotone"
                          dataKey={shop}
                          stroke={["#0ea5e9", "#22c55e", "#f97316", "#a855f7", "#ef4444"][index % 5]}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="flex flex-wrap gap-2">
                {shopNames.map((shop) => {
                  const active = enabledShops.includes(shop);
                  return (
                    <button
                      key={shop}
                      type="button"
                      onClick={() => {
                        setEnabledShops((current) =>
                          active ? current.filter((item) => item !== shop) : [...current, shop],
                        );
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs",
                        active ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground",
                      )}
                    >
                      {shop}
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-xl border border-border p-3 text-sm">Мин: <strong>{formatPriceWithSum(historyMin)}</strong></div>
                <div className="rounded-xl border border-border p-3 text-sm">Макс: <strong>{formatPriceWithSum(historyMax)}</strong></div>
                <div className="rounded-xl border border-border p-3 text-sm">Жорий: <strong>{formatPriceWithSum(historyCurrent)}</strong></div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Ҳафта</th>
                      <th className="px-3 py-2">Дўкон</th>
                      <th className="px-3 py-2">Ҳафталик энг паст</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklySummary.map((row) => (
                      <tr key={`${row.weekKey}-${row.shop}`} className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">{row.weekLabel}</td>
                        <td className="px-3 py-2">{row.shop}</td>
                        <td className="px-3 py-2 font-medium">{formatPriceWithSum(row.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : null}

      {activeTab === "similar" && similar.length > 0 ? (
        <div id="similar" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {similar.map((item) => (
            <Link key={item.id} href={`/product/${item.slug}`} className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-accent/40">
              <div className="relative mb-2 h-32 overflow-hidden rounded-lg bg-secondary/30">
                {item.image ? (
                  <Image src={item.image} alt={item.name} fill className="object-contain p-2" sizes="220px" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Рассиз</div>
                )}
              </div>
              <p className="min-h-[40px] text-sm font-medium [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
                {item.name}
              </p>
              <p className="mt-1 text-sm text-accent">дан {formatPriceWithSum(item.minPrice)}</p>
              <p className="text-xs text-muted-foreground">{item.shopCount} {offerCountLabel(item.shopCount)}</p>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SimilarProductsSection({ items }: { items: SimilarProductItem[] }) {
  if (!items.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Ўхшаш товарлар</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.slice(0, 6).map((item) => (
          <Link key={item.id} href={`/product/${item.slug}`} className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-accent/40">
            <div className="relative mb-2 h-28 overflow-hidden rounded-lg bg-secondary/20">
              {item.image ? <Image src={item.image} alt={item.name} fill className="object-contain p-2" sizes="200px" /> : null}
            </div>
            <p className="text-sm font-medium [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">{item.name}</p>
            <p className="mt-1 text-sm text-accent">дан {formatPriceWithSum(item.minPrice)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function RecentlyViewedSection({ currentId }: { currentId: string }) {
  const items = useRecentlyViewedStore((state) => state.items);
  const recent = items.filter((item) => item.id !== currentId).slice(0, 8);

  if (!recent.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Яқинда кўрилганлар</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {recent.map((item) => (
          <Link key={item.id} href={`/product/${item.slug}`} className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-accent/40">
            <div className="relative mb-2 h-24 overflow-hidden rounded-lg bg-secondary/20">
              {item.imageUrl ? <Image src={item.imageUrl} alt={item.title} fill className="object-contain p-2" sizes="190px" /> : null}
            </div>
            <p className="text-sm font-medium [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">{item.title}</p>
            {item.minPrice != null ? <p className="text-sm text-accent">дан {formatPriceWithSum(item.minPrice)}</p> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ProductClientPage({ initialProduct }: ProductClientPageProps) {
  const me = useAuthMe();
  const favoritesQuery = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const pushRecentlyViewed = useRecentlyViewedStore((state) => state.push);

  const compareItems = useCompareStore((state) => state.items);
  const toggleCompare = useCompareStore((state) => state.toggle);
  const clearCompare = useCompareStore((state) => state.clear);

  const [variantState, setVariantState] = useState<Record<string, string>>({});
  const [similarFallback, setSimilarFallback] = useState(initialProduct.similar);
  const offersAnchorRef = useRef<HTMLDivElement>(null);

  const variantQuery = useMemo(() => {
    const search = new URLSearchParams();
    Object.entries(variantState).forEach(([key, value]) => {
      if (value) search.append(key, value);
    });
    return search.toString();
  }, [variantState]);

  const productQuery = useQuery({
    queryKey: ["product-page", initialProduct.id, variantQuery],
    queryFn: async () => {
      const response = await fetch(`/api/products/${initialProduct.id}${variantQuery ? `?${variantQuery}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("product_fetch_error");
      return (await response.json()) as ProductPageData;
    },
    initialData: initialProduct,
    staleTime: 60_000,
  });

  const similarQuery = useQuery({
    queryKey: ["product-page", initialProduct.id, "similar"],
    queryFn: async () => {
      const response = await fetch(`/api/products/${initialProduct.id}/similar?limit=6`, { cache: "no-store" });
      if (!response.ok) return [] as SimilarProductItem[];
      return (await response.json()) as SimilarProductItem[];
    },
    initialData: initialProduct.similar,
    staleTime: 120_000,
  });

  const product = productQuery.data ?? initialProduct;
  const similarItems = similarQuery.data?.length ? similarQuery.data : similarFallback;

  useEffect(() => {
    if (similarQuery.data?.length) setSimilarFallback(similarQuery.data);
  }, [similarQuery.data]);

  const favoriteSet = useMemo(() => new Set((favoritesQuery.data ?? []).map((item) => item.product_id)), [favoritesQuery.data]);
  const isFavorite = favoriteSet.has(product.id);
  const inCompare = compareItems.some((item) => item.id === product.id);

  useEffect(() => {
    pushRecentlyViewed({
      id: product.id,
      slug: product.slug,
      title: product.name,
      imageUrl: product.images[0] ?? null,
      minPrice: product.minPrice,
    });

    try {
      const current = JSON.parse(localStorage.getItem("doxx_recent") ?? "[]") as string[];
      const next = [product.id, ...current.filter((id) => id !== product.id)].slice(0, 20);
      localStorage.setItem("doxx_recent", JSON.stringify(next));
    } catch {
      // ignore localStorage errors
    }

    if (me.data?.id) {
      void fetch("/api/user/recently-viewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
    }
  }, [me.data?.id, product.id, product.minPrice, product.name, product.slug, product.images, pushRecentlyViewed]);

  const firstImage = product.images[0] ?? undefined;
  const hasVariantSelection = Object.values(variantState).some((value) => Boolean(value));

  if (productQuery.isFetching && hasVariantSelection && !productQuery.isLoading && productQuery.data) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <ProductPageSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-24 md:pb-6">
      <Breadcrumb
        items={[
          { label: "Бош саҳифа", href: "/" },
          { label: product.category, href: "/catalog" },
          { label: product.brand, href: `/catalog?q=${encodeURIComponent(product.brand)}` },
          { label: product.name },
        ]}
      />

      <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)_240px]">
        <ProductGallery
          images={product.images}
          priceDrop={product.priceDrop}
          isNew={product.isNew}
          categoryLabel={product.category}
          actions={(
            <>
              <Button
                variant={isFavorite ? "default" : "outline"}
                className="gap-2"
                onClick={() =>
                  toggleFavorite.mutate({
                    productId: product.id,
                    currentPrice: product.minPrice,
                  })
                }
              >
                <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} />
                Сараланган
              </Button>
              <Button
                variant={inCompare ? "default" : "outline"}
                className="gap-2"
                onClick={() =>
                  toggleCompare({
                    id: product.id,
                    title: product.name,
                    slug: product.slug,
                    category: product.category,
                    image: firstImage,
                  })
                }
              >
                <Scale className="h-4 w-4" />
                Солиштириш
              </Button>
            </>
          )}
        />

        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {product.category} ·{" "}
            <Link href={`/catalog?q=${encodeURIComponent(product.brand)}`} className="text-accent hover:underline">
              {product.brand}
            </Link>
          </p>

          <h1 className="text-2xl font-semibold leading-tight md:text-3xl">{product.name}</h1>

          <div className="flex items-center gap-2 text-sm">
            <StarRating value={product.rating} readonly />
            <span>{product.rating.toFixed(1)}</span>
            <span className="text-muted-foreground">{product.reviewCount} та фикр</span>
            <a href="#reviews" className="text-accent hover:underline">Ўқиш →</a>
          </div>

          <div className="rounded-xl bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">Энг паст нарх</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-semibold">{formatPriceWithSum(product.minPrice)}</span>
              {product.oldPrice ? <span className="text-sm text-muted-foreground line-through">{formatPriceWithSum(product.oldPrice)}</span> : null}
              {product.priceDrop > 0 ? <span className="text-sm text-emerald-600">↓ {product.priceDrop}%</span> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {product.offerCount} {offerCountLabel(product.offerCount)} · етказиб бериш {product.minDelivery} кундан
            </p>
            <PriceAlertButton product={product} />
          </div>

          <VariantSelector variants={product.variants} value={variantState} onChange={setVariantState} />

          {product.keySpecs.length ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              {product.keySpecs.map((spec) => (
                <div key={spec.key} className="flex items-center justify-between gap-2 border-b border-border/60 pb-2 text-sm last:border-none last:pb-0">
                  <span className="text-muted-foreground">{spec.label}</span>
                  <span className="font-medium">{spec.value}</span>
                </div>
              ))}
              <a href="#specs" className="inline-block text-sm font-medium text-accent hover:underline">
                Барча хусусиятлар ({Object.keys(product.specs).length}) →
              </a>
            </div>
          ) : null}
        </section>

        <div className="hidden md:block">
          <OffersPanel product={product} offers={product.offers} />
        </div>
      </div>

      <ProductTabs product={product} similar={similarItems} isAuthenticated={Boolean(me.data?.id)} />

      <section className="md:hidden">
        <OffersPanel product={product} offers={product.offers} offersRef={offersAnchorRef} />
      </section>

      <SimilarProductsSection items={similarItems} />
      <RecentlyViewedSection currentId={product.id} />

      {compareItems.length >= 2 ? (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
            <div className="flex -space-x-2">
              {compareItems.slice(0, 4).map((item) => (
                <div key={item.id} className="relative h-9 w-9 overflow-hidden rounded-full border border-border bg-card">
                  {item.image ? (
                    <Image src={item.image} alt={item.title} fill className="object-cover" sizes="36px" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">#{item.id.slice(0, 2)}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="text-sm font-medium">Солиштириляпти: {compareItems.length} та товар</div>

            <div className="ml-auto flex items-center gap-2">
              <Link href="/compare" className="inline-flex items-center rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white">
                Солиштириш →
              </Link>
              <button type="button" onClick={clearCompare} className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground">
                ✕
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={cn("fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 md:hidden", compareItems.length >= 2 && "hidden")}>
        <div className="mx-auto flex max-w-7xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">дан {formatPriceWithSum(product.minPrice)}</p>
            <p className="text-xs text-muted-foreground">{product.offerCount} {offerCountLabel(product.offerCount)}</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              offersAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Таклифларни кўриш →
          </Button>
        </div>
      </div>
    </div>
  );
}
