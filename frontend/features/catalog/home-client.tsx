"use client";

import { useQueries } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, Sparkles, TimerReset, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";

import { CatalogGrid } from "@/components/catalog/catalog-grid";
import { PriceAlertBadge } from "@/components/common/price-alert-badge";
import { SectionHeading } from "@/components/common/section-heading";
import { Badge } from "@/components/ui/badge";
import { useAuthMe } from "@/features/auth/use-auth";
import { useCatalogProducts, useCategories } from "@/features/catalog/use-catalog-queries";
import { useFavorites } from "@/features/user/use-favorites";
import { catalogApi } from "@/lib/api/openapi-client";
import { buildPriceAlertSignal, toPositivePriceOrNull } from "@/lib/utils/price-alerts";
import { formatPrice } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { usePriceAlertsStore } from "@/store/priceAlerts.store";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";

const trustItems = [
  {
    icon: ShieldCheck,
    title: "Проверенные магазины",
    description: "Работаем только с доверенными партнерами для вашей безопасности.",
    color: "text-blue-500"
  },
  {
    icon: TimerReset,
    title: "Цены в реальном времени",
    description: "Данные обновляются каждые 15 минут, чтобы вы не упустили выгоду.",
    color: "text-amber-500"
  },
  {
    icon: Sparkles,
    title: "Умные алгоритмы",
    description: "Искусственный интеллект помогает найти лучшее сочетание цены и качества.",
    color: "text-purple-500"
  }
];

const encyclopediaSections = [
  {
    title: "Как выбрать идеальный смартфон",
    description: "Разбор ключевых параметров: от матрицы экрана до светосилы камер.",
    href: "/catalog?q=смартфон",
    image: "📱"
  },
  {
    title: "Гид по современным ноутбукам",
    description: "Для работы, творчества и игр: подбираем оптимальное железо под ваши задачи.",
    href: "/catalog?q=ноутбук",
    image: "💻"
  },
  {
    title: "Мир Hi-Fi звука и TWS",
    description: "Сравнение кодеков, драйверов и систем активного шумоподавления.",
    href: "/catalog?q=наушники",
    image: "🎧"
  }
];

const editorialSelections = [
  {
    title: "Флагманы 2026: Битва титанов",
    description: "Честное сравнение топовых моделей года по всем характеристикам.",
    href: "/catalog?q=смартфон&max_price=15000000&sort=popular",
    tag: "Подборка",
    gradient: "from-blue-500/10 to-cyan-500/10"
  },
  {
    title: "Рабочие станции для PRO",
    description: "Выбор профессионалов для монтажа 8K и тяжелого 3D-рендеринга.",
    href: "/catalog?q=ноутбук+для+работы&sort=popular",
    tag: "Гид",
    gradient: "from-purple-500/10 to-pink-500/10"
  },
  {
    title: "Бюджетный гейминг: Миф или реальность?",
    description: "Собираем игровой сетап, который не ударит по карману, но потянет хиты.",
    href: "/catalog?q=игровой&sort=price_asc",
    tag: "Тренд",
    gradient: "from-orange-500/10 to-red-500/10"
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
  const brands = useMemo(() => {
    const values = new Set<string>();
    for (const item of trending.data?.items ?? []) {
      const raw = item.brand?.name;
      const normalized = typeof raw === "string" ? raw.trim() : "";
      if (!normalized) continue;
      values.add(normalized);
    }
    return Array.from(values).slice(0, 8);
  }, [trending.data?.items]);
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
  const categoryPulse = useMemo(() => {
    const grouped = new Map<string, { count: number; storeCount: number; pricedSum: number; pricedItems: number }>();
    for (const item of trending.data?.items ?? []) {
      const categoryName = item.category?.name?.trim() || "Прочее";
      const bucket = grouped.get(categoryName) ?? { count: 0, storeCount: 0, pricedSum: 0, pricedItems: 0 };
      bucket.count += 1;
      bucket.storeCount += Number(item.store_count ?? 0);
      const price = typeof item.min_price === "number" && Number.isFinite(item.min_price) ? item.min_price : null;
      if (price !== null) {
        bucket.pricedSum += price;
        bucket.pricedItems += 1;
      }
      grouped.set(categoryName, bucket);
    }

    return Array.from(grouped.entries())
      .map(([category, bucket]) => {
        const coverage = Math.round((bucket.storeCount / Math.max(bucket.count, 1)) * 10) / 10;
        const avgPrice = bucket.pricedItems > 0 ? bucket.pricedSum / bucket.pricedItems : null;
        const score = Math.min(5, Math.max(1, Math.round((coverage / 2) * 10) / 10));
        return { category, score, coverage, avgPrice, sampleSize: bucket.count };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [trending.data?.items]);

  const popularRequests = useMemo(() => {
    const suggestions: Array<{ label: string; href: string }> = [];
    for (const category of categories.data ?? []) {
      if (suggestions.length >= 4) break;
      suggestions.push({ label: `${category.name} до 10 млн`, href: `/catalog?q=${encodeURIComponent(category.name)}&max_price=10000000` });
    }
    for (const brand of brands) {
      if (suggestions.length >= 8) break;
      suggestions.push({ label: `${brand} выгодные предложения`, href: `/catalog?q=${encodeURIComponent(brand)}&sort=price_asc` });
    }
    return suggestions;
  }, [brands, categories.data]);

  const fadeUp = { hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0 } };

  return (
    <div className="container space-y-24 py-12">
      {/* ── Hero ────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="relative min-h-[540px] overflow-hidden rounded-[3rem] border border-border/40 bg-card p-1 shadow-2xl"
      >
        {/* Decorative orbs */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full bg-primary/10 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-32 -left-32 h-[420px] w-[420px] rounded-full bg-accent/10 blur-[120px]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[140px]" />

        <div className="relative z-10 flex flex-col items-center px-8 py-20 text-center md:px-16 md:py-28">
          <Badge className="mb-8 rounded-full border-primary/20 bg-primary/10 px-5 py-2 text-sm font-black uppercase tracking-widest text-primary backdrop-blur-sm shadow-none">
            E-katalog Premium
          </Badge>

          <h1 className="max-w-5xl font-heading text-4xl font-[900] italic leading-[1.05] tracking-tighter md:text-7xl">
            Умное сравнение цен для{" "}
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              идеальных покупок.
            </span>
          </h1>

          <p className="mt-10 max-w-2xl text-lg font-bold leading-relaxed text-muted-foreground md:text-xl">
            Мы агрегируем тысячи предложений от проверенных магазинов, чтобы вы могли сэкономить время и деньги, выбирая лучшее.
          </p>

          <div className="mt-14 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/catalog"
              className="group relative inline-flex h-16 items-center justify-center overflow-hidden rounded-2xl bg-primary px-12 py-4 font-black text-primary-foreground shadow-xl shadow-primary/30 transition-all hover:scale-105 hover:shadow-2xl hover:shadow-primary/40 active:scale-100"
            >
              <span className="relative z-10 flex items-center gap-2">
                Начать поиск <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </span>
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </Link>
            <Link
              href="/compare"
              className="inline-flex h-16 items-center justify-center rounded-2xl border-2 border-border bg-background/50 px-12 py-4 font-black backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-secondary hover:shadow-lg"
            >
              Таблица сравнения
            </Link>
          </div>
        </div>
      </motion.section>

      {/* ── Trust Bar ──────────────────────────────────────────── */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5 }}
        className="grid overflow-hidden rounded-[2.5rem] border border-border/40 bg-card/60 backdrop-blur-sm md:grid-cols-3"
      >
        {trustItems.map((item, idx) => (
          <div
            key={item.title}
            className={cn(
              "group flex flex-col items-start gap-5 p-10 transition-all hover:bg-card/80",
              idx !== trustItems.length - 1 && "md:border-r border-border/40"
            )}
          >
            <div className={cn("rounded-2xl p-4 shadow-sm ring-1 ring-border/20 transition-transform group-hover:scale-110", item.color, "bg-background")}>
              <item.icon className="h-7 w-7" />
            </div>
            <div className="space-y-2">
              <h3 className="font-heading text-lg font-black tracking-tight">{item.title}</h3>
              <p className="text-sm font-medium leading-relaxed text-muted-foreground">{item.description}</p>
            </div>
          </div>
        ))}
      </motion.section>

      {/* ── Trending Products ──────────────────────────────────── */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5 }}
      >
        <SectionHeading title="Популярные товары" description="Чаще всего просматривают за последние дни" action={<TrendingUp className="h-5 w-5 text-primary" />} />
        <CatalogGrid loading={trending.isLoading} items={trending.data?.items ?? []} />
      </motion.section>

      {/* ── Watchlist Price Drops ───────────────────────────────── */}
      {showWatchlistTeaser ? (
        <motion.section
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-[2.5rem] border border-primary/20 bg-card/90 p-8 shadow-xl md:p-10"
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
          <SectionHeading title="Снижения цен по вашему списку" description="Алерты на базе избранного и текущих минимальных цен." />
          <div className="grid gap-4 md:grid-cols-2">
            {priceDropItems.map((item) => (
              <Link
                key={item.id}
                href={`/product/${item.slug}`}
                className="group rounded-[2rem] border border-border/40 bg-background/60 p-6 transition-all hover:border-primary/30 hover:bg-secondary/30 hover:shadow-lg"
              >
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <PriceAlertBadge signal={item.signal} />
                  <Badge className="rounded-full bg-primary/10 px-3 py-1 font-black text-primary shadow-none">{item.signal.drop_pct.toFixed(1)}%</Badge>
                </div>
                <p className="line-clamp-2 text-sm font-black leading-snug group-hover:text-primary transition-colors">{item.title}</p>
                <p className="mt-2 text-xs font-bold text-muted-foreground">
                  Текущая цена: {item.currentPrice != null ? formatPrice(item.currentPrice) : "нет данных"}
                </p>
              </Link>
            ))}
          </div>
        </motion.section>
      ) : null}

      {/* ── Categories ─────────────────────────────────────────── */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5 }}
      >
        <SectionHeading title="Категории" description="Быстрый переход к основным разделам каталога" />
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {(categories.data ?? []).slice(0, 12).map((category, idx) => (
            <Link key={category.id} href={`/category/${category.slug}`} className="group relative">
              <div className="flex h-full flex-col items-center justify-center rounded-[2rem] border border-border/40 bg-card/60 p-6 text-center backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-card hover:shadow-xl hover:-translate-y-1">
                <div className={cn(
                  "mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-black text-white shadow-lg transition-transform group-hover:scale-110",
                  ["bg-gradient-to-br from-blue-500 to-blue-600", "bg-gradient-to-br from-purple-500 to-purple-600", "bg-gradient-to-br from-amber-500 to-amber-600", "bg-gradient-to-br from-emerald-500 to-emerald-600", "bg-gradient-to-br from-rose-500 to-rose-600", "bg-gradient-to-br from-indigo-500 to-indigo-600"][idx % 6]
                )}>
                  {category.name.charAt(0)}
                </div>
                <span className="text-sm font-black leading-tight tracking-tight group-hover:text-primary transition-colors">
                  {category.name}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </motion.section>

      {/* ── Category Pulse Ratings ─────────────────────────────── */}
      {categoryPulse.length ? (
        <motion.section
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5 }}
        >
          <SectionHeading title="Рейтинг категорий" description="Оценка интереса и насыщенности предложений по популярным товарам." />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categoryPulse.map((item) => (
              <div key={item.category} className="rounded-[2rem] border border-border/40 bg-card/60 p-6 backdrop-blur-sm transition-all hover:bg-card hover:shadow-lg">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <p className="text-sm font-black tracking-tight">{item.category}</p>
                  <Badge className="rounded-full border-primary/30 bg-primary/10 px-3 py-1 font-black text-primary shadow-none">{item.score.toFixed(1)} / 5</Badge>
                </div>
                {/* Visual score bar */}
                <div className="mb-4 h-2 overflow-hidden rounded-full bg-secondary/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
                    style={{ width: `${(item.score / 5) * 100}%` }}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-muted-foreground">
                    В среднем {item.coverage.toFixed(1)} магазина на товар.
                  </p>
                  <p className="text-xs font-bold text-muted-foreground">
                    {item.avgPrice != null ? `Средняя мин. цена: ${formatPrice(item.avgPrice)}` : "Цена уточняется"}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">
                    Основано на {item.sampleSize} карточках
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      ) : null}

      {/* ── Popular Queries ────────────────────────────────────── */}
      {popularRequests.length ? (
        <motion.section
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
        >
          <SectionHeading title="Популярные запросы" description="Быстрые сценарии поиска, которыми часто пользуются покупатели." />
          <div className="flex flex-wrap gap-3">
            {popularRequests.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-full border border-border/60 bg-card/60 px-5 py-2.5 text-sm font-bold backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary hover:shadow-md"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </motion.section>
      ) : null}

      {/* ── Encyclopedia ───────────────────────────────────────── */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5 }}
        className="rounded-[2.5rem] bg-secondary/20 px-8 py-14 md:px-14"
      >
        <SectionHeading title="Энциклопедия выбора" description="Короткие тематические гиды для более осознанной покупки." />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {encyclopediaSections.map((section) => (
            <Link key={section.title} href={section.href}>
              <div className="group h-full overflow-hidden rounded-[2rem] border border-border/40 bg-card/80 transition-all hover:-translate-y-2 hover:border-primary/40 hover:shadow-2xl">
                <div className="flex h-36 items-center justify-center bg-gradient-to-br from-secondary/60 to-secondary/30 text-6xl transition-transform group-hover:scale-110">
                  {section.image}
                </div>
                <div className="space-y-3 p-7">
                  <h3 className="font-heading text-lg font-black tracking-tight group-hover:text-primary transition-colors">{section.title}</h3>
                  <p className="text-sm font-medium leading-relaxed text-muted-foreground">{section.description}</p>
                  <p className="flex items-center gap-1 text-xs font-black uppercase tracking-widest text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Читать гид <ArrowRight className="h-3 w-3" />
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </motion.section>

      {/* ── Editorial Selections ───────────────────────────────── */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5 }}
      >
        <SectionHeading title="Редакционные подборки" description="Кураторские сценарии выбора: что смотреть в первую очередь." />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {editorialSelections.map((item) => (
            <Link key={item.title} href={item.href}>
              <div className={cn(
                "group h-full overflow-hidden rounded-[2.5rem] border-none p-1 transition-all hover:scale-[1.03] hover:shadow-xl bg-gradient-to-br",
                item.gradient
              )}>
                <div className="flex h-full flex-col justify-between rounded-[2.3rem] bg-card/80 p-8 backdrop-blur-sm">
                  <div>
                    <Badge className="mb-5 rounded-full border-primary/20 bg-background/60 px-4 py-1.5 font-black uppercase tracking-widest text-primary shadow-none backdrop-blur-sm">
                      {item.tag}
                    </Badge>
                    <h3 className="font-heading text-xl font-[900] italic leading-tight tracking-tight">{item.title}</h3>
                    <p className="mt-3 text-sm font-medium text-foreground/60 leading-relaxed">{item.description}</p>
                  </div>
                  <div className="mt-6 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-primary transition-all group-hover:gap-3">
                    Смотреть подборку <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </motion.section>

      {/* ── Popular Brands ─────────────────────────────────────── */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5 }}
      >
        <SectionHeading title="Популярные бренды" />
        <div className="flex flex-wrap gap-3">
          {brands.map((brand) => (
            <Badge
              key={brand}
              className="rounded-full border-border/60 bg-card/60 px-5 py-2.5 text-sm font-black backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary hover:shadow-md cursor-default"
            >
              {brand}
            </Badge>
          ))}
        </div>
      </motion.section>

      {/* ── Recently Viewed ────────────────────────────────────── */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5 }}
      >
        <SectionHeading title="Недавно просмотренные" description="История ваших последних интересов для быстрого возврата." />
        {recent.length ? (
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recent.map((item) => (
              <Link key={item.id} href={`/product/${item.slug}`} className="group block">
                <div className="flex items-center gap-5 rounded-[2rem] border border-border/40 bg-card/60 p-5 backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-card hover:shadow-lg hover:-translate-y-0.5">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-secondary/80 to-secondary/40 text-2xl shadow-inner">
                    🔍
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-black group-hover:text-primary transition-colors">{item.title}</p>
                    <p className="mt-1.5 flex items-center gap-1 text-xs font-bold text-muted-foreground">
                      Открыть товар <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-border/40 py-16 text-center">
            <div className="mb-5 text-5xl opacity-20">🕒</div>
            <p className="text-sm font-bold text-muted-foreground">Здесь появятся товары, которые вы недавно открывали.</p>
          </div>
        )}
      </motion.section>
    </div>
  );
}

