"use client";

import { motion } from "framer-motion";
import { BellRing, Heart, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useLocale } from "@/components/common/locale-provider";
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
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);

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
    return <ErrorState title={tr("Товар недоступен", "Товар мавжуд эмас")} message={tr("Этот товар был удален или временно недоступен.", "Бу товар ўчирилган ёки вақтинча мавжуд эмас.")} />;
  }

  if (product.isLoading || !product.data) {
    return <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-muted-foreground">{tr("Загружаем карточку товара...", "Товар карточкаси юкланмоқда...")}</div>;
  }

  const inCompare = compareItems.some((item) => item.id === product.data.id);
  const compareFull = compareItems.length >= COMPARE_LIMIT;
  const referenceCompareCategory = getReferenceCompareCategory(compareItems.map((item) => item.category));
  const productCategory = normalizeCategory(product.data.category);
  const categoryMismatch = Boolean(referenceCompareCategory && productCategory && referenceCompareCategory !== productCategory);
  const compareDisabled = !inCompare && (compareFull || categoryMismatch);
  const compareDisabledReason = compareFull
    ? tr(`Лимит: ${COMPARE_LIMIT} товара`, `Лимит: ${COMPARE_LIMIT} та товар`)
    : categoryMismatch
      ? tr("Сравнение доступно только в рамках одной категории", "Солиштириш фақат битта категория доирасида мумкин")
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
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8">
      <Breadcrumbs
        items={[
          { href: "/", label: tr("Главная", "Бош саҳифа") },
          { href: "/catalog", label: tr("Каталог", "Каталог") },
          { href: `/product/${slug}`, label: product.data.title }
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <ProductGallery images={galleryImages} />

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="space-y-5 lg:sticky lg:top-20 lg:self-start"
        >
          {/* Category & brand badges */}
          <div className="flex flex-wrap gap-2">
            {product.data.category && (
              <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">{product.data.category}</span>
            )}
            {product.data.brand && (
              <span className="rounded-md bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">{product.data.brand}</span>
            )}
          </div>

          <h1 className="font-heading text-2xl font-bold leading-snug text-foreground md:text-3xl">{product.data.title}</h1>

          {/* Price */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{tr("Минимальная цена", "Энг паст нарх")}</p>
            <p className="mt-1 text-3xl font-bold text-accent">
              {currentMinPrice != null ? formatPrice(currentMinPrice) : tr("Нет данных", "Маълумот йўқ")}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              className="flex-1 gap-2"
              variant={isFavorite ? "default" : "outline"}
              onClick={handleFavoriteToggle}
            >
              <Heart className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
              {isFavorite ? tr("В избранном", "Сараланганларда") : tr("В избранное", "Сараланганларга")}
            </Button>
            <Button
              className="flex-1 gap-2"
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
              <Scale className="h-4 w-4" />
              {inCompare ? tr("В сравнении", "Солиштиришда") : tr("Сравнить", "Солиштириш")}
            </Button>
          </div>

          {/* Short desc */}
          {product.data.short_description && (
            <p className="text-sm leading-relaxed text-muted-foreground">{product.data.short_description}</p>
          )}

          {/* What's new */}
          {product.data.whats_new?.length ? (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">{tr("Что нового", "Янги жиҳатлар")}</p>
              <ul className="space-y-1.5 text-sm">
                {product.data.whats_new.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </motion.section>
      </div>

      {/* Price tracking */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4 }}
        className="rounded-2xl border border-border bg-card p-5"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <BellRing className="h-4 w-4 text-accent" />
          <h2 className="font-heading text-lg font-bold">{tr("Отслеживание цены", "Нарх кузатуви")}</h2>
          <PriceAlertBadge signal={alertSignal} />
        </div>

        {!me.data?.id ? (
          <p className="text-sm text-muted-foreground">
            {tr("Чтобы включить отслеживание цены,", "Нарх кузатувини ёқиш учун")}{" "}
            <Link href="/login" className="font-semibold text-accent hover:underline">
              {tr("войдите в аккаунт", "аккаунтга киринг")}
            </Link>
            .
          </p>
        ) : !isFavorite ? (
          <p className="text-sm text-muted-foreground">
            {tr("Добавьте товар в избранное, чтобы отслеживать снижение цены и достижение вашей цели.", "Нарх пасайиши ва мақсадга етишни кузатиш учун товарни сараланганларга қўшинг.")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { label: tr("Текущая цена", "Жорий нарх"), value: currentMinPrice != null ? formatPrice(currentMinPrice) : tr("Нет данных", "Маълумот йўқ") },
                { label: tr("Базовая цена", "Базавий нарх"), value: alertMeta?.baseline_price != null ? formatPrice(alertMeta.baseline_price) : tr("Не задана", "Белгиланмаган") },
                { label: tr("Целевая цена", "Мақсад нархи"), value: alertMeta?.target_price != null ? formatPrice(alertMeta.target_price) : tr("Не задана", "Белгиланмаган") },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={alertMeta?.alerts_enabled ? "default" : "outline"}
                size="sm"
                onClick={handleToggleAlertsEnabled}
                className={alertMeta?.alerts_enabled ? "bg-accent text-white hover:bg-accent/90" : ""}
              >
                {alertMeta?.alerts_enabled ? tr("Алерты включены", "Алертлар ёқилган") : tr("Включить алерты", "Алертларни ёқиш")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleResetBaseline}>
                {tr("Обновить базу", "Базани янгилаш")}
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full max-w-xs space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{tr("Целевая цена (UZS)", "Мақсад нархи (UZS)")}</label>
                <Input
                  value={targetPriceInput}
                  onChange={(e) => setTargetPriceInput(e.target.value)}
                  placeholder={tr("Например: 12 000 000", "Масалан: 12 000 000")}
                />
              </div>
              <Button size="sm" onClick={handleTargetSave}>
                {tr("Сохранить цель", "Мақсадни сақлаш")}
              </Button>
            </div>
          </div>
        )}
      </motion.section>

      {/* Tabs */}
      <Tabs defaultValue="offers" className="space-y-4">
        <TabsList className="flex w-full flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
          <TabsTrigger value="offers">{tr("Предложения", "Таклифлар")}</TabsTrigger>
          <TabsTrigger value="history">{tr("История цены", "Нарх тарихи")}</TabsTrigger>
          <TabsTrigger value="specs">{tr("Характеристики", "Хусусиятлар")}</TabsTrigger>
          <TabsTrigger value="reviews">{tr("Отзывы", "Изоҳлар")}</TabsTrigger>
          <TabsTrigger value="qa">{tr("Вопросы и ответы", "Савол ва жавоблар")}</TabsTrigger>
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
