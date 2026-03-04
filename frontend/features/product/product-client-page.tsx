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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthMe } from "@/features/auth/use-auth";
import { useProduct } from "@/features/catalog/use-catalog-queries";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import { useDeleteUserPriceAlert, useUpsertUserPriceAlert, useUserPriceAlerts } from "@/features/user/use-price-alerts";
import { userApi, type UserPriceAlert } from "@/lib/api/openapi-client";
import { formatPrice } from "@/lib/utils/format";
import { buildPriceAlertSignal, toPositivePriceOrNull } from "@/lib/utils/price-alerts";
import { COMPARE_LIMIT, useCompareStore } from "@/store/compare.store";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";

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
  const pushRecentlyViewed = useRecentlyViewedStore((state) => state.push);
  const compareItemsStore = useCompareStore((state) => state.items);
  const toggleCompare = useCompareStore((state) => state.toggle);
  const alertMetas = usePriceAlertsStore((state) => state.metas);
  const mergeServerMetas = usePriceAlertsStore((state) => state.mergeServerMetas);
  const ensureAlertMeta = usePriceAlertsStore((state) => state.ensureMeta);
  const setAlertsEnabled = usePriceAlertsStore((state) => state.setAlertsEnabled);
  const setTargetPrice = usePriceAlertsStore((state) => state.setTargetPrice);
  const resetBaseline = usePriceAlertsStore((state) => state.resetBaseline);
  const updateLastSeen = usePriceAlertsStore((state) => state.updateLastSeen);
  const removeAlertMeta = usePriceAlertsStore((state) => state.removeMeta);
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
      minPrice: currentMinPrice,
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
    return <ErrorState title="Товар недоступен" message="Этот товар был удален или временно недоступен." />;
  }

  if (product.isLoading || !product.data) {
    return <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">Загружаем карточку товара...</div>;
  }

  const inCompare = compareItems.some((item) => item.id === product.data.id);
  const compareFull = compareItems.length >= COMPARE_LIMIT;
  const referenceCompareCategory = getReferenceCompareCategory(compareItems.map((item) => item.category));
  const productCategory = normalizeCategory(product.data.category);
  const categoryMismatch = Boolean(referenceCompareCategory && productCategory && referenceCompareCategory !== productCategory);
  const compareDisabled = !inCompare && (compareFull || categoryMismatch);
  const compareDisabledReason = compareFull
    ? `Лимит: ${COMPARE_LIMIT} товара`
    : categoryMismatch
      ? "Сравнение доступно только в рамках одной категории"
      : undefined;
  const galleryImages = product.data.gallery_images?.length ? product.data.gallery_images : product.data.main_image ? [product.data.main_image] : [];

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
      const alertId = alertMeta && typeof (alertMeta as { id?: unknown }).id === "string" ? (alertMeta as unknown as { id: string }).id : null;
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
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <Breadcrumbs items={[{ href: "/", label: "Главная" }, { href: "/catalog", label: "Каталог" }, { href: `/product/${slug}`, label: product.data.title }]} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <ProductGallery images={galleryImages} />

        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h1 className="font-heading text-2xl font-bold">{product.data.title}</h1>
          <p className="text-sm text-muted-foreground">Проверенные предложения по магазинам и обновляемая история цен в одном месте.</p>
          <div className="grid gap-2 rounded-xl border border-border bg-card p-3 text-sm">
            <p>
              <span className="text-muted-foreground">Категория:</span> {product.data.category}
            </p>
            {product.data.brand ? (
              <p>
                <span className="text-muted-foreground">Бренд:</span> {product.data.brand}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Минимальная цена:</span>{" "}
              <span className="font-semibold text-accent">{currentMinPrice != null ? formatPrice(currentMinPrice) : "Нет данных"}</span>
            </p>
          </div>

          {product.data.short_description ? (
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Краткое описание</p>
              <p className="mt-1 text-sm">{product.data.short_description}</p>
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Что нового</p>
            {product.data.whats_new?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                {product.data.whats_new.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Данные об обновлениях этой модели пока отсутствуют.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={handleFavoriteToggle}>
              <Heart className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
              {isFavorite ? "В избранном" : "Добавить в избранное"}
            </Button>
            <Button
              variant={inCompare ? "default" : "outline"}
              onClick={() =>
                toggleCompare({
                  id: product.data.id,
                  title: product.data.title,
                  slug,
                  category: product.data.category,
                })
              }
              disabled={compareDisabled}
              title={compareDisabled ? compareDisabledReason : undefined}
            >
              {inCompare ? "Уже в сравнении" : "Добавить к сравнению"}
            </Button>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <BellRing className="h-4 w-4 text-accent" />
          <h2 className="font-heading text-lg font-bold">Отслеживание цены</h2>
          <PriceAlertBadge signal={alertSignal} />
        </div>

        {!me.data?.id ? (
          <p className="text-sm text-muted-foreground">
            Чтобы включить отслеживание цены, <Link href="/login" className="font-semibold text-accent hover:underline">войдите в аккаунт</Link>.
          </p>
        ) : !isFavorite ? (
          <p className="text-sm text-muted-foreground">Добавьте товар в избранное, чтобы отслеживать снижение цены и достижение вашей цели.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">Текущая цена</p>
                <p className="text-sm font-semibold">{currentMinPrice != null ? formatPrice(currentMinPrice) : "Нет данных"}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">Базовая цена</p>
                <p className="text-sm font-semibold">{alertMeta?.baseline_price != null ? formatPrice(alertMeta.baseline_price) : "Не задана"}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">Целевая цена</p>
                <p className="text-sm font-semibold">{alertMeta?.target_price != null ? formatPrice(alertMeta.target_price) : "Не задана"}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant={alertMeta?.alerts_enabled ? "default" : "outline"} size="sm" onClick={handleToggleAlertsEnabled}>
                {alertMeta?.alerts_enabled ? "Алерты включены" : "Включить алерты"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleResetBaseline}>
                Обновить базу
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full max-w-xs space-y-1">
                <label className="text-xs text-muted-foreground">Целевая цена (UZS)</label>
                <Input value={targetPriceInput} onChange={(event) => setTargetPriceInput(event.target.value)} placeholder="Например: 12000000" />
              </div>
              <Button size="sm" onClick={handleTargetSave}>
                Сохранить цель
              </Button>
            </div>
          </div>
        )}
      </section>

      <Tabs defaultValue="offers" className="space-y-4">
        <TabsList className="flex w-full flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
          <TabsTrigger value="offers">Предложения</TabsTrigger>
          <TabsTrigger value="history">История цены</TabsTrigger>
          <TabsTrigger value="specs">Характеристики</TabsTrigger>
          <TabsTrigger value="reviews">Отзывы</TabsTrigger>
          <TabsTrigger value="qa">Вопросы и ответы</TabsTrigger>
        </TabsList>
        <TabsContent value="offers">
          <OfferTable offersByStore={product.data.offers_by_store ?? []} />
        </TabsContent>
        <TabsContent value="history">
          <PriceHistoryCard productId={product.data.id} />
        </TabsContent>
        <TabsContent value="specs">
          <SpecsTable specs={product.data.specs} />
        </TabsContent>
        <TabsContent value="reviews">
          <ProductReviewsPanel productId={product.data.id} />
        </TabsContent>
        <TabsContent value="qa">
          <ProductQuestionsPanel productId={product.data.id} />
        </TabsContent>
      </Tabs>

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
                seller: { "@type": "Organization", name: offer.seller_name },
              }))
            ),
          }),
        }}
      />
    </div>
  );
}
