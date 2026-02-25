"use client";

import { useQueries } from "@tanstack/react-query";
import { ShieldCheck, Sparkles, TimerReset, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";

import { CatalogGrid } from "@/components/catalog/catalog-grid";
import { PriceAlertBadge } from "@/components/common/price-alert-badge";
import { SectionHeading } from "@/components/common/section-heading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthMe } from "@/features/auth/use-auth";
import { useCatalogProducts, useCategories } from "@/features/catalog/use-catalog-queries";
import { useFavorites } from "@/features/user/use-favorites";
import { catalogApi } from "@/lib/api/openapi-client";
import { buildPriceAlertSignal, toPositivePriceOrNull } from "@/lib/utils/price-alerts";
import { formatPrice } from "@/lib/utils/format";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";

const brands = ["Apple", "Samsung", "Xiaomi", "HP", "Lenovo", "Sony"];

const trustItems = [
  {
    icon: ShieldCheck,
    title: "Проверенные магазины",
    description: "Работаем с доверенными источниками и показываем прозрачные офферы."
  },
  {
    icon: TimerReset,
    title: "Актуализация цен",
    description: "Регулярно обновляем прайс-данные, чтобы выбор был ближе к реальности."
  },
  {
    icon: Sparkles,
    title: "Умное сравнение",
    description: "Быстро сравнивайте цену, характеристики и доступность в одном интерфейсе."
  }
];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const getMinPrice = (offersByStore: Array<{ minimal_price: number }>) => {
  if (!offersByStore.length) return null;
  const min = offersByStore.reduce((acc, store) => Math.min(acc, Number(store.minimal_price)), Number.POSITIVE_INFINITY);
  return Number.isFinite(min) ? min : null;
};

export function HomeClient() {
  const me = useAuthMe();
  const favorites = useFavorites();
  const trending = useCatalogProducts({ limit: 6, sort: "popular" });
  const categories = useCategories();
  const recentItems = useRecentlyViewedStore((s) => s.items);
  const recent = recentItems.slice(0, 6);
  const priceAlertMetas = usePriceAlertsStore((s) => s.metas);
  const ensureAlertMeta = usePriceAlertsStore((s) => s.ensureMeta);

  const favoriteIds = useMemo(() => (favorites.data ?? []).map((item) => item.product_id), [favorites.data]);

  const favoriteProductQueries = useQueries({
    queries: favoriteIds.slice(0, 6).map((productId) => ({
      queryKey: ["catalog", "product", productId, "home-watchlist"],
      queryFn: () => catalogApi.getProduct(productId),
      staleTime: 60_000
    }))
  });

  useEffect(() => {
    favoriteProductQueries.forEach((query, index) => {
      const productId = favoriteIds[index];
      if (!productId || !query.data) return;
      ensureAlertMeta(productId, getMinPrice(query.data.offers_by_store));
    });
  }, [ensureAlertMeta, favoriteIds, favoriteProductQueries]);

  const priceDropItems = useMemo(
    () =>
      favoriteProductQueries.flatMap((query, index) => {
        const product = query.data;
        const productId = favoriteIds[index];
        if (!product || !productId) return [];
        const meta = priceAlertMetas[productId];
        if (!meta || !meta.alerts_enabled) return [];
        const currentPrice = toPositivePriceOrNull(getMinPrice(product.offers_by_store));
        const signal = buildPriceAlertSignal(meta, currentPrice);
        if (!signal.is_drop && !signal.is_target_hit) return [];
        return [
          {
            id: productId,
            title: product.title,
            slug: `${productId}-${slugify(product.title)}`,
            currentPrice,
            signal
          }
        ];
      }),
    [favoriteIds, favoriteProductQueries, priceAlertMetas]
  );
  const showWatchlistTeaser = Boolean(me.data?.id && priceDropItems.length > 0);

  return (
    <div className="container space-y-12 py-6">
      <section className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-8 shadow-soft">
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />

        <Badge className="mb-4 w-fit border-primary/30 bg-primary/15 text-primary">E-katalog</Badge>
        <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight md:text-5xl">Сравнивайте цены на технику по проверенным магазинам за пару кликов.</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Единый каталог, прозрачные предложения, история стоимости и удобные инструменты для взвешенной покупки.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/catalog" className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-soft">
            Перейти в каталог
          </Link>
          <Link href="/compare" className="rounded-2xl border border-border bg-background/80 px-5 py-3 text-sm font-semibold">
            Открыть сравнение
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {trustItems.map((item) => (
          <Card key={item.title}>
            <CardContent className="space-y-3 p-5">
              <item.icon className="h-5 w-5 text-primary" />
              <h3 className="font-heading text-base font-bold">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section>
        <SectionHeading title="Популярные товары" description="Чаще всего просматривают за последние дни" action={<TrendingUp className="h-5 w-5 text-primary" />} />
        <CatalogGrid loading={trending.isLoading} items={trending.data?.items ?? []} />
      </section>

      {showWatchlistTeaser ? (
        <section className="rounded-2xl border border-border/80 bg-card/90 p-5 shadow-soft">
          <SectionHeading title="Снижения цен по вашему списку отслеживания" description="Локальные алерты на базе избранного и текущих минимальных цен." />
          <div className="grid gap-3 md:grid-cols-2">
            {priceDropItems.map((item) => (
              <Link key={item.id} href={`/product/${item.slug}`} className="rounded-xl border border-border/80 bg-background/70 p-4 transition-colors hover:bg-secondary/50">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <PriceAlertBadge signal={item.signal} />
                  <Badge>{item.signal.drop_pct.toFixed(1)}%</Badge>
                </div>
                <p className="line-clamp-2 text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Текущая цена: {item.currentPrice != null ? formatPrice(item.currentPrice) : "нет данных"}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeading title="Категории" description="Быстрый переход к основным разделам каталога" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {(categories.data ?? []).slice(0, 12).map((category) => (
            <Link key={category.id} href={`/category/${category.slug}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="p-4 text-sm font-semibold">{category.name}</CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Популярные бренды" />
        <div className="flex flex-wrap gap-2">
          {brands.map((brand) => (
            <Badge key={brand} className="rounded-2xl px-4 py-2 text-sm">
              {brand}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Недавно просмотренные" />
        {recent.length ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {recent.map((item) => (
              <Link key={item.id} href={`/product/${item.slug}`} className="rounded-2xl border border-border bg-card p-4 text-sm shadow-soft">
                {item.title}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Здесь появятся товары, которые вы недавно открывали.</p>
        )}
      </section>
    </div>
  );
}
