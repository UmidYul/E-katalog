"use client";

import { BellRing, Heart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { ErrorState } from "@/components/common/error-state";
import { PriceAlertBadge } from "@/components/common/price-alert-badge";
import { OfferTable } from "@/components/product/offer-table";
import { PriceHistoryCard } from "@/components/product/price-history-card";
import { ProductQuestionsPanel, ProductReviewsPanel } from "@/components/product/product-feedback-panels";
import { ProductGallery } from "@/components/product/product-gallery";
import { SpecsTable } from "@/components/product/specs-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthMe } from "@/features/auth/use-auth";
import { useProduct } from "@/features/catalog/use-catalog-queries";
import { useToggleFavorite, useFavorites } from "@/features/user/use-favorites";
import { useDeleteUserPriceAlert, useUpsertUserPriceAlert, useUserPriceAlerts } from "@/features/user/use-price-alerts";
import { userApi, type UserPriceAlert } from "@/lib/api/openapi-client";
import { buildPriceAlertSignal, toPositivePriceOrNull } from "@/lib/utils/price-alerts";
import { formatPrice } from "@/lib/utils/format";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

const normalizeCategory = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
};

const getReferenceCompareCategory = (categories: Array<string | undefined>) => {
  for (const category of categories) {
    const normalized = normalizeCategory(category);
    if (normalized) return normalized;
  }
  return undefined;
};

const getProductMinPrice = (offersByStore: Array<{ minimal_price: number }>) => {
  if (!offersByStore.length) return null;
  const min = offersByStore.reduce((acc, store) => Math.min(acc, Number(store.minimal_price)), Number.POSITIVE_INFINITY);
  return Number.isFinite(min) ? min : null;
};

export function ProductClientPage({ productId, slug }: { productId: string; slug: string }) {
  const me = useAuthMe();
  const favorites = useFavorites();
  const product = useProduct(productId);
  const toggleFavorite = useToggleFavorite();
  const serverPriceAlerts = useUserPriceAlerts();
  const upsertPriceAlert = useUpsertUserPriceAlert();
  const deletePriceAlert = useDeleteUserPriceAlert();
  const pushRecentlyViewed = useRecentlyViewedStore((s) => s.push);
  const compareItemsStore = useCompareStore((s) => s.items);
  const toggleCompare = useCompareStore((s) => s.toggle);
  const alertMetas = usePriceAlertsStore((s) => s.metas);
  const mergeServerMetas = usePriceAlertsStore((s) => s.mergeServerMetas);
  const ensureAlertMeta = usePriceAlertsStore((s) => s.ensureMeta);
  const setAlertsEnabled = usePriceAlertsStore((s) => s.setAlertsEnabled);
  const setTargetPrice = usePriceAlertsStore((s) => s.setTargetPrice);
  const resetBaseline = usePriceAlertsStore((s) => s.resetBaseline);
  const updateLastSeen = usePriceAlertsStore((s) => s.updateLastSeen);
  const removeAlertMeta = usePriceAlertsStore((s) => s.removeMeta);
  const [mounted, setMounted] = useState(false);
  const [targetPriceInput, setTargetPriceInput] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  const compareItems = mounted ? compareItemsStore : [];
  const favoriteSet = useMemo(() => new Set((favorites.data ?? []).map((item) => item.product_id)), [favorites.data]);

  const currentMinPrice = useMemo(
    () => (product.data ? toPositivePriceOrNull(getProductMinPrice(product.data.offers_by_store)) : null),
    [product.data]
  );
  const currentProductId = product.data?.id;
  const currentProductTitle = product.data?.title;
  const serverAlertMap = useMemo(() => {
    const map = new Map<string, UserPriceAlert>();
    for (const alert of serverPriceAlerts.data ?? []) {
      if (alert?.product_id) {
        map.set(alert.product_id, alert);
      }
    }
    return map;
  }, [serverPriceAlerts.data]);

  const isFavorite = Boolean(currentProductId && favoriteSet.has(currentProductId));

  useEffect(() => {
    if (!currentProductId || !currentProductTitle) return;
    pushRecentlyViewed({
      id: currentProductId,
      slug,
      title: currentProductTitle,
      minPrice: currentMinPrice
    });
    if (me.data?.id) {
      void userApi.pushRecentlyViewed(currentProductId).catch(() => undefined);
    }
  }, [currentMinPrice, currentProductId, currentProductTitle, me.data?.id, pushRecentlyViewed, slug]);

  useEffect(() => {
    if (!currentProductId || !isFavorite) return;
    ensureAlertMeta(currentProductId, currentMinPrice);
    updateLastSeen(currentProductId, currentMinPrice);
  }, [currentMinPrice, currentProductId, ensureAlertMeta, isFavorite, updateLastSeen]);

  useEffect(() => {
    if (!serverPriceAlerts.data?.length) return;
    mergeServerMetas(serverPriceAlerts.data);
  }, [mergeServerMetas, serverPriceAlerts.data]);

  const alertMeta = currentProductId ? serverAlertMap.get(currentProductId) ?? alertMetas[currentProductId] : undefined;
  const alertSignal = alertMeta ? buildPriceAlertSignal(alertMeta, currentMinPrice) : null;

  useEffect(() => {
    setTargetPriceInput(alertMeta?.target_price != null ? String(Math.round(alertMeta.target_price)) : "");
  }, [alertMeta?.target_price]);

  if (product.error) {
    return <ErrorState title="Товар недоступен" message="Похоже, этот товар был удалён или временно недоступен." />;
  }

  if (product.isLoading || !product.data) {
    return <div className="container py-8 text-sm text-muted-foreground">Загружаем карточку товара...</div>;
  }

  const inCompare = compareItems.some((item) => item.id === product.data.id);
  const compareFull = compareItems.length >= COMPARE_LIMIT;
  const referenceCompareCategory = getReferenceCompareCategory(compareItems.map((item) => item.category));
  const productCategory = normalizeCategory(product.data.category);
  const categoryMismatch = Boolean(referenceCompareCategory && productCategory && referenceCompareCategory !== productCategory);
  const compareDisabled = !inCompare && (compareFull || categoryMismatch);
  const compareDisabledReason = compareFull ? `Лимит: ${COMPARE_LIMIT} товара` : categoryMismatch ? "Сравнение доступно только в рамках одной категории" : undefined;
  const galleryImages =
    product.data.gallery_images?.length
      ? product.data.gallery_images
      : product.data.main_image
        ? [product.data.main_image]
        : [];

  const handleFavoriteToggle = () => {
    const id = product.data.id;
    const nextFavorite = !isFavorite;
    if (nextFavorite) {
      ensureAlertMeta(id, currentMinPrice);
      setAlertsEnabled(id, true, currentMinPrice);
      if (me.data?.id) {
        void upsertPriceAlert
          .mutateAsync({
            productId: id,
            alerts_enabled: true,
            current_price: currentMinPrice,
            channel: "telegram",
          })
          .catch(() => undefined);
      }
    } else {
      removeAlertMeta(id);
      const alertId =
        alertMeta && typeof (alertMeta as { id?: unknown }).id === "string"
          ? (alertMeta as unknown as { id: string }).id
          : null;
      if (me.data?.id && alertId) {
        void deletePriceAlert.mutateAsync(alertId).catch(() => undefined);
      }
    }
    toggleFavorite.mutate(id);
  };

  const handleTargetSave = () => {
    if (!product.data) return;
    if (!targetPriceInput.trim()) {
      setTargetPrice(product.data.id, null);
      if (me.data?.id) {
        void upsertPriceAlert
          .mutateAsync({
            productId: product.data.id,
            target_price: null,
            current_price: currentMinPrice,
            channel: "telegram",
          })
          .catch(() => undefined);
      }
      return;
    }
    const numeric = Number(targetPriceInput.replace(/\s+/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setTargetPrice(product.data.id, numeric);
    if (me.data?.id) {
      void upsertPriceAlert
        .mutateAsync({
          productId: product.data.id,
          target_price: numeric,
          current_price: currentMinPrice,
          channel: "telegram",
        })
        .catch(() => undefined);
    }
  };

  const handleToggleAlertsEnabled = () => {
    const nextEnabled = !Boolean(alertMeta?.alerts_enabled);
    setAlertsEnabled(product.data.id, nextEnabled, currentMinPrice);
    if (me.data?.id) {
      void upsertPriceAlert
        .mutateAsync({
          productId: product.data.id,
          alerts_enabled: nextEnabled,
          current_price: currentMinPrice,
          channel: "telegram",
        })
        .catch(() => undefined);
    }
  };

  const handleResetBaseline = () => {
    resetBaseline(product.data.id, currentMinPrice);
    if (me.data?.id) {
      void upsertPriceAlert
        .mutateAsync({
          productId: product.data.id,
          baseline_price: currentMinPrice,
          current_price: currentMinPrice,
          channel: "telegram",
        })
        .catch(() => undefined);
    }
  };

  return (
    <div className="container min-h-screen space-y-12 py-10">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge className="w-fit border-primary/20 bg-primary/10 text-primary">Original Product</Badge>
          <div className="h-1 w-1 rounded-full bg-border" />
          <span className="text-sm text-muted-foreground">{product.data.category}</span>
        </div>
        <Breadcrumbs items={[{ href: "/", label: "Главная" }, { href: "/catalog", label: "Каталог" }, { href: `/product/${slug}`, label: product.data.title }]} />
      </div>

      <div className="grid gap-12 lg:grid-cols-[1fr_450px]">
        <div className="space-y-12">
          <section className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card p-2 md:p-6 shadow-xl">
            <ProductGallery images={galleryImages} />
          </section>

          <Tabs defaultValue="offers" className="w-full">
            <TabsList className="bg-secondary/40 h-auto w-full flex-wrap justify-start gap-2 border-b border-border/50 p-2">
              <TabsTrigger value="offers" className="rounded-xl px-6 py-3 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-md">Предложения</TabsTrigger>
              <TabsTrigger value="history" className="rounded-xl px-6 py-3 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-md">История цен</TabsTrigger>
              <TabsTrigger value="specs" className="rounded-xl px-6 py-3 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-md">Характеристики</TabsTrigger>
              <TabsTrigger value="reviews" className="rounded-xl px-6 py-3 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-md">Отзывы</TabsTrigger>
              <TabsTrigger value="qa" className="rounded-xl px-6 py-3 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-md">Q&A</TabsTrigger>
            </TabsList>
            <div className="mt-8">
              <TabsContent value="offers"><OfferTable offersByStore={product.data.offers_by_store ?? []} /></TabsContent>
              <TabsContent value="history"><PriceHistoryCard productId={product.data.id} /></TabsContent>
              <TabsContent value="specs"><SpecsTable specs={product.data.specs} /></TabsContent>
              <TabsContent value="reviews"><ProductReviewsPanel productId={product.data.id} /></TabsContent>
              <TabsContent value="qa"><ProductQuestionsPanel productId={product.data.id} /></TabsContent>
            </div>
          </Tabs>
        </div>

        <aside className="space-y-8">
          <section className="sticky top-24 space-y-6 rounded-[2rem] border border-border/50 bg-card p-8 shadow-2xl">
            <div className="space-y-4">
              <h1 className="font-heading text-3xl font-[900] leading-tight tracking-tight">{product.data.title}</h1>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-[900] text-primary">
                  {currentMinPrice != null ? formatPrice(currentMinPrice) : "Цена уточняется"}
                </span>
                {alertSignal?.is_drop && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                    -{alertSignal.drop_pct.toFixed(0)}%
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid gap-4">
              <Button
                className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-white shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[1.0]"
                onClick={handleFavoriteToggle}
              >
                <Heart className={cn("mr-2 h-5 w-5", isFavorite && "fill-current")} />
                {isFavorite ? "В избранном" : "В список желаний"}
              </Button>
              <Button
                variant="outline"
                className="h-14 w-full rounded-2xl border-2 border-border font-bold hover:bg-secondary hover:border-primary/20"
                onClick={() =>
                  toggleCompare({
                    id: product.data.id,
                    title: product.data.title,
                    slug,
                    category: product.data.category
                  })
                }
                disabled={compareDisabled}
              >
                {inCompare ? "В сравнении" : "К сравнению"}
              </Button>
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-center gap-2 border-l-4 border-primary/40 pl-4 py-1">
                <BellRing className="h-4 w-4 text-primary" />
                <h2 className="text-lg font-bold">Радар цен</h2>
              </div>

              {!me.data?.id ? (
                <div className="rounded-2xl bg-secondary/30 p-4 text-sm text-muted-foreground">
                  Войдите, чтобы получать пуш-уведомления при снижении цены.
                </div>
              ) : !isFavorite ? (
                <div className="rounded-2xl bg-secondary/30 p-4 text-sm text-muted-foreground">
                  Активируется при добавлении в избранное.
                </div>
              ) : (
                <div className="space-y-4 rounded-2xl bg-secondary/30 p-6">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase text-muted-foreground">Целевая цена</span>
                    <PriceAlertBadge signal={alertSignal} />
                  </div>
                  <div className="flex gap-2">
                    <Input
                      className="rounded-xl border-none bg-background/50 focus-visible:ring-primary/30"
                      value={targetPriceInput}
                      onChange={(e) => setTargetPriceInput(e.target.value)}
                      placeholder="UZS"
                    />
                    <Button size="sm" className="rounded-xl px-4" onClick={handleTargetSave}>Set</Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn("h-8 rounded-lg text-xs font-bold", alertMeta?.alerts_enabled ? "text-primary bg-primary/10" : "text-muted-foreground")}
                      onClick={handleToggleAlertsEnabled}
                    >
                      {alertMeta?.alerts_enabled ? "ON" : "OFF"} Notifications
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 rounded-lg text-xs font-bold" onClick={handleResetBaseline}>Reset Base</Button>
                  </div>
                </div>
              )}
            </div>

            {product.data.short_description && (
              <div className="space-y-2 py-4 text-sm leading-relaxed text-muted-foreground border-t border-border/40">
                <p>{product.data.short_description}</p>
              </div>
            )}

            {product.data.whats_new?.length ? (
              <div className="rounded-2xl bg-amber-500/[0.03] border border-amber-500/10 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-amber-500">✨</span>
                  <span className="text-xs font-[900] uppercase tracking-wider text-amber-600">Что нового в модели</span>
                </div>
                <ul className="space-y-2">
                  {product.data.whats_new.map((item, idx) => (
                    <li key={item} className="text-xs text-amber-700/80 flex items-start gap-2">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.data.title,
            offers: (product.data.offers_by_store ?? []).flatMap((block) =>
              block.offers.map((offer) => ({
                "@type": "Offer",
                price: offer.price_amount,
                priceCurrency: offer.currency,
                availability: offer.in_stock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                seller: { "@type": "Organization", name: offer.seller_name }
              }))
            )
          })
        }}
      />
    </div>
  );
}

