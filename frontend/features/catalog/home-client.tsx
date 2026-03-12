"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Headphones,
  Home,
  Laptop,
  RotateCcw,
  Shield,
  Smartphone,
  Star,
  Truck,
  Tv,
  Watch,
} from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useLocale, useT } from "@/components/common/locale-provider";
import { useBrands, useCatalogProducts, useCategories } from "@/features/catalog/use-catalog-queries";
import { catalogApi } from "@/lib/api/openapi-client";
import { formatPrice } from "@/lib/utils/format";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";
import type { ProductListItem } from "@/types/domain";

type HeroSlide = {
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  href: string;
  bgClass: string;
};

type SideHeroCard = {
  title: string;
  subtitle: string;
  href: string;
  bgClass: string;
};

const heroSlides: HeroSlide[] = [
  {
    title: "Сравнивайте цены на технику в одном месте",
    subtitle: "Проверенные магазины",
    description: "Актуальные предложения, история цен и удобный выбор — за пару кликов.",
    cta: "Перейти в каталог",
    href: "/catalog",
    bgClass: "from-primary to-primary/85",
  },
  {
    title: "Подберите ноутбук и смартфон выгоднее",
    subtitle: "Сравнение офферов",
    description: "Смотрите разброс цен по продавцам и выбирайте оптимальное предложение.",
    cta: "Смотреть подборки",
    href: "/catalog?sort=popular",
    bgClass: "from-primary/90 to-primary",
  },
  {
    title: "Умные фильтры для быстрого выбора",
    subtitle: "Категории и бренды",
    description: "Фильтруйте по цене, бренду и характеристикам без потери актуальности.",
    cta: "Открыть фильтры",
    href: "/catalog",
    bgClass: "from-primary to-accent/60",
  },
];

const sideHeroCards = [
  { title: "Избранное и алерты", subtitle: "Отслеживайте падение цены", href: "/favorites", bgClass: "from-primary/90 to-primary" },
  { title: "Сравнение 1 к 1", subtitle: "Выберите лучший вариант", href: "/compare", bgClass: "from-accent/70 to-primary" },
];

const categoryIcons = [Smartphone, Laptop, Tv, Headphones, Camera, Home, Watch, Smartphone];

const articles = [
  {
    category: "Гид по выбору",
    title: "Как выбрать ноутбук для учебы и работы",
    description: "Разбираем ключевые параметры: процессор, память, экран и автономность.",
    href: "/catalog?q=ноутбук",
    image: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=1200&q=80",
  },
  {
    category: "Подборка",
    title: "Лучшие смартфоны в популярных сегментах",
    description: "Сравниваем модели по камере, производительности и времени работы.",
    href: "/catalog?q=смартфон&sort=popular",
    image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80",
  },
  {
    category: "База знаний",
    title: "С чего начать настройку умного дома",
    description: "Короткий план по стартовым устройствам и связкам экосистем.",
    href: "/catalog?q=умный дом",
    image: "https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=1200&q=80",
  },
];

const tags = [
  "iPhone 15",
  "Смартфоны до 8 млн",
  "Ноутбуки для учебы",
  "4K телевизоры",
  "Беспроводные наушники",
  "Умные часы",
  "Игровые решения",
  "Wi-Fi роутеры",
];

const advantages = [
  { icon: Truck, title: "Быстрая доставка", description: "Сроки и доступность у продавцов" },
  { icon: Shield, title: "Проверенные офферы", description: "Прозрачная витрина цен по магазинам" },
  { icon: CreditCard, title: "Удобный выбор", description: "Сравнение цен и характеристик в одном интерфейсе" },
  { icon: RotateCcw, title: "История стоимости", description: "Отслеживайте динамику цен по товарам" },
];

const promotions = [
  {
    title: "Сделка дня",
    description: "Отмеченные предложения с лучшей ценой за последние сутки.",
    href: "/catalog?sort=price_asc",
    badge: "Выгодно",
  },
  {
    title: "Новые поступления",
    description: "Свежие карточки товаров и обновленные офферы продавцов.",
    href: "/catalog?sort=newest",
    badge: "Новинки",
  },
  {
    title: "Популярные бренды",
    description: "Смотрите востребованные модели и сегменты по брендам.",
    href: "/catalog?sort=popular",
    badge: "Тренд",
  },
];

function HeroBanner({
  slides,
  sideCards,
  prevSlideLabel,
  nextSlideLabel,
  slideLabel,
}: {
  slides: HeroSlide[];
  sideCards: SideHeroCard[];
  prevSlideLabel: string;
  nextSlideLabel: string;
  slideLabel: (index: number) => string;
}) {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [slides.length]);

  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % slides.length);

  return (
    <section className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex gap-4">
        <div className="relative flex-1 overflow-hidden rounded-2xl border border-border/40">
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${currentSlide * 100}%)` }}
          >
            {slides.map((slide) => (
              <div
                key={slide.title}
                className={`flex min-w-full flex-col justify-center bg-gradient-to-br ${slide.bgClass} px-8 py-16 md:px-14 md:py-24`}
              >
                <motion.span
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mb-3 inline-block w-fit rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white/90"
                >
                  {slide.subtitle}
                </motion.span>
                <motion.h1
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18 }}
                  className="mb-3 text-balance font-heading text-3xl font-bold text-white md:text-5xl"
                >
                  {slide.title}
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.26 }}
                  className="mb-8 max-w-xl text-sm text-white/80 md:text-base"
                >
                  {slide.description}
                </motion.p>
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34 }}>
                  <Link
                    href={slide.href}
                    className="inline-flex w-fit items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-accent shadow-lg transition-all hover:scale-[1.03] hover:shadow-xl active:scale-[0.98]"
                  >
                    {slide.cta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </motion.div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={prevSlide}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 text-white backdrop-blur-sm transition-colors hover:bg-white/35"
            aria-label={prevSlideLabel}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={nextSlide}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 text-white backdrop-blur-sm transition-colors hover:bg-white/35"
            aria-label={nextSlideLabel}
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
            {slides.map((slide, index) => (
              <button
                type="button"
                key={slide.title}
                onClick={() => setCurrentSlide(index)}
                className={`h-2 rounded-full transition-all duration-300 ${index === currentSlide ? "w-7 bg-white" : "w-2 bg-white/40"}`}
                aria-label={slideLabel(index + 1)}
              />
            ))}
          </div>
        </div>

        <div className="hidden w-64 flex-col gap-4 lg:flex">
          {sideCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className={`group flex flex-1 flex-col justify-end rounded-2xl border border-border/40 bg-gradient-to-br ${card.bgClass} p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg`}
            >
              <h2 className="font-heading text-lg font-bold text-white">{card.title}</h2>
              <p className="mt-1.5 flex items-center gap-1 text-sm text-white/75 transition-all group-hover:gap-2">
                {card.subtitle}
                <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:opacity-100" />
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductCard({ item }: { item: ProductListItem }) {
  const slug = `${item.id}-${slugify(item.normalized_title)}`;
  const hasOldPrice = typeof item.max_price === "number" && typeof item.min_price === "number" && item.max_price > item.min_price;
  const reviews = Math.max(24, Math.round((item.score ?? 0) * 120));
  const image = normalizeImageUrl(item.image_url);

  return (
    <motion.div whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}>
      <Link
        href={`/product/${slug}`}
        className="group flex min-w-[220px] shrink-0 flex-col rounded-2xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md"
      >
        <div className="relative aspect-square overflow-hidden rounded-t-2xl bg-secondary/30 p-4">
          {image ? (
            <Image
              src={image}
              alt={item.normalized_title}
              fill
              className="object-contain p-2 transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 85vw, 220px"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="h-24 w-24 rounded-xl bg-muted sm:h-28 sm:w-28" />
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col p-3">
          <h3 className="mb-2 line-clamp-2 text-sm font-medium leading-relaxed text-foreground">{item.normalized_title}</h3>
          <div className="mb-2 flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star key={index} className={`h-3 w-3 ${index < 4 ? "fill-amber-400 text-amber-400" : "text-border"}`} />
            ))}
            <span className="ml-1.5 text-xs text-muted-foreground">({reviews})</span>
          </div>
          <div className="mt-auto">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-accent">{formatPrice(item.min_price ?? 0)}</span>
              {hasOldPrice ? <span className="text-sm text-muted-foreground line-through">{formatPrice(item.max_price ?? 0)}</span> : null}
            </div>
            <span className="mt-1 block text-xs text-muted-foreground">
              {item.store_count} {item.store_count === 1 ? "магазин" : "магазинов"}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function ProductSection({ title, items }: { title: string; items: ProductListItem[] }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="mx-auto max-w-7xl px-4 py-12"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold text-foreground md:text-3xl">{title}</h2>
        <Link href="/catalog" className="inline-flex items-center gap-1 text-sm font-medium text-accent transition-all hover:gap-2">
          Смотреть все
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="scrollbar-hide -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
        {items.length ? (
          items.map((item) => <ProductCard key={item.id} item={item} />)
        ) : (
          <div className="flex w-full gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="min-w-[220px] shrink-0 rounded-2xl border border-border bg-card">
                <div className="aspect-square rounded-t-2xl bg-muted/60" />
                <div className="space-y-2 p-3">
                  <div className="h-4 w-3/4 rounded-md bg-muted/60" />
                  <div className="h-4 w-1/2 rounded-md bg-muted/60" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}

function NewsletterSection() {
  const t = useT("pages.home");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <section className="bg-accent">
      <div className="mx-auto max-w-7xl px-4 py-16">
        <div className="mx-auto max-w-xl text-center">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-3 font-heading text-2xl font-bold text-white md:text-3xl"
          >
            {t("newsletterTitle")}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mb-6 text-sm text-white/75"
          >
            {t("newsletterText")}
          </motion.p>
          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-xl bg-white/20 px-4 py-3 text-sm font-medium text-white"
              >
                {t("newsletterThanks")}
              </motion.div>
            ) : (
              <motion.form
                key="form"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) setSubmitted(true);
                }}
                className="flex gap-2"
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("newsletterEmailPlaceholder")}
                  className="flex-1 rounded-xl bg-white/15 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/40"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-accent transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
                >
                  {t("newsletterButton")}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const isImageUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return /^https?:\/\//i.test(normalized) || normalized.startsWith("/");
};

const normalizeImageUrl = (value: unknown): string | null => {
  if (!isImageUrl(value)) return null;
  const normalized = value.trim();
  if (normalized.startsWith("/")) return normalized;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "api") {
      return `${parsed.pathname}${parsed.search}`;
    }
    return normalized;
  } catch {
    return normalized;
  }
};

export function HomeClient() {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);
  const t = useT("pages.home");
  const categories = useCategories();
  const brands = useBrands();
  const popular = useCatalogProducts({ limit: 8, sort: "popular" });
  const newest = useCatalogProducts({ limit: 8, sort: "newest" });
  const recentItems = useRecentlyViewedStore((state) => state.items).slice(0, 4);
  const recentImageQueries = useQueries({
    queries: recentItems.map((item) => ({
      queryKey: ["recently-viewed-image", item.id],
      queryFn: async () => {
        const product = await catalogApi.getProduct(item.id);
        return product.main_image ?? product.gallery_images?.[0] ?? null;
      },
      enabled: Boolean(item.id) && !isImageUrl(item.imageUrl),
      staleTime: 1000 * 60 * 10,
    })),
  });

  const topCategories = useMemo(() => (categories.data ?? []).slice(0, 8), [categories.data]);
  const topBrands = useMemo(() => (brands.data ?? []).slice(0, 16), [brands.data]);
  const tagLinks = tags.map((tag) => ({ tag, href: `/catalog?q=${encodeURIComponent(tag)}` }));
  const localizedHeroSlides = useMemo<HeroSlide[]>(
    () =>
      isUz
        ? [
            {
              title: "Техникалар нархини бир жойда солиштиринг",
              subtitle: "Текширилган дўконлар",
              description: "Долзарб таклифлар, нарх тарихи ва қулай танлов — бир неча босишда.",
              cta: "Каталогга ўтиш",
              href: "/catalog",
              bgClass: "from-primary to-primary/85",
            },
            {
              title: "Ноутбук ва смартфонни фойдали танланг",
              subtitle: "Таклифларни солиштириш",
              description: "Сотувчилар кесимида нархлар фарқини кўринг ва энг мақбул таклифни танланг.",
              cta: "Сараламаларни кўриш",
              href: "/catalog?sort=popular",
              bgClass: "from-primary/90 to-primary",
            },
            {
              title: "Тез танлов учун ақлли фильтрлар",
              subtitle: "Категория ва брендлар",
              description: "Нарх, бренд ва хусусиятлар бўйича фильтрланг ва долзарбликни йўқотманг.",
              cta: "Фильтрларни очиш",
              href: "/catalog",
              bgClass: "from-primary to-accent/60",
            },
          ]
        : heroSlides,
    [isUz]
  );
  const localizedSideHeroCards = useMemo<SideHeroCard[]>(
    () =>
      isUz
        ? [
            { title: "Сараланганлар ва алертлар", subtitle: "Нарх тушишини кузатинг", href: "/favorites", bgClass: "from-primary/90 to-primary" },
            { title: "1 га 1 солиштириш", subtitle: "Энг яхши вариантни танланг", href: "/compare", bgClass: "from-accent/70 to-primary" },
          ]
        : sideHeroCards,
    [isUz]
  );
  const localizedAdvantages = useMemo(
    () =>
      isUz
        ? [
            { icon: Truck, title: "Тез етказиб бериш", description: "Сотувчиларда муддат ва мавжудлик" },
            { icon: Shield, title: "Текширилган таклифлар", description: "Дўконлар бўйича очиқ нархлар витринаси" },
            { icon: CreditCard, title: "Қулай танлов", description: "Нарх ва хусусиятларни битта интерфейсда солиштириш" },
            { icon: RotateCcw, title: "Нарх тарихи", description: "Товарлар бўйича нарх динамикасини кузатинг" },
          ]
        : advantages,
    [isUz]
  );
  const localizedPromotions = useMemo(
    () =>
      isUz
        ? [
            { title: "Кун таклифи", description: "Сўнгги суткада энг яхши нархга эга таклифлар.", href: "/catalog?sort=price_asc", badge: "Фойдали" },
            { title: "Янги тушумлар", description: "Янги товар карточкалари ва янгиланган сотувчи таклифлари.", href: "/catalog?sort=newest", badge: "Янги" },
            { title: "Оммавий брендлар", description: "Брендлар бўйича талабгир моделлар ва сегментларни кўринг.", href: "/catalog?sort=popular", badge: "Тренд" },
          ]
        : promotions,
    [isUz]
  );
  const localizedArticles = useMemo(
    () =>
      isUz
        ? [
            {
              category: "Танлов бўйича қўлланма",
              title: "Ўқиш ва иш учун ноутбукни қандай танлаш керак",
              description: "Асосий параметрларни кўриб чиқамиз: процессор, хотира, экран ва автономлик.",
              href: "/catalog?q=ноутбук",
              image: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=1200&q=80",
            },
            {
              category: "Саралама",
              title: "Оммавий сегментлардаги энг яхши смартфонлар",
              description: "Моделларни камера, унумдорлик ва ишлаш вақти бўйича солиштирамиз.",
              href: "/catalog?q=смартфон&sort=popular",
              image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80",
            },
            {
              category: "Билимлар базаси",
              title: "Ақлли уйни созлашни нимадан бошлаш керак",
              description: "Бошланғич қурилмалар ва экотизим боғламалари бўйича қисқа режа.",
              href: "/catalog?q=умный дом",
              image: "https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=1200&q=80",
            },
          ]
        : articles,
    [isUz]
  );
  const recentImageById = useMemo(() => {
    const map = new Map<string, string | null>();
    recentItems.forEach((item, index) => {
      const fromStore = normalizeImageUrl(item.imageUrl);
      const fromQuery = recentImageQueries[index]?.data;
      map.set(item.id, fromStore ?? normalizeImageUrl(fromQuery));
    });
    return map;
  }, [recentImageQueries, recentItems]);

  const fadeUp = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <div className="min-h-screen bg-background">
      <HeroBanner
        slides={localizedHeroSlides}
        sideCards={localizedSideHeroCards}
        prevSlideLabel={t("heroPrevSlide")}
        nextSlideLabel={t("heroNextSlide")}
        slideLabel={(index) => t("heroSlideN", { index })}
      />

      {/* Advantages strip */}
      <section className="border-y border-border bg-secondary/30">
        <div className="mx-auto max-w-7xl px-4">
          <div className="grid grid-cols-2 divide-x divide-border md:grid-cols-4">
            {localizedAdvantages.map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="flex items-center gap-3 px-4 py-5"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent/10">
                  <item.icon className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="mx-auto max-w-7xl px-4 py-12"
      >
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">{t("categoriesTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:gap-4">
          {topCategories.map((category, index) => {
            const Icon = categoryIcons[index % categoryIcons.length] ?? Smartphone;
            return (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 text-center shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-accent/30 hover:shadow-md"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary transition-colors group-hover:bg-accent/10">
                  <Icon className="h-7 w-7 text-accent" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{category.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("categoryCardLabel")}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </motion.section>

      <ProductSection title={t("hitsTitle")} items={popular.data?.items ?? []} />
      <ProductSection title={t("newArrivalsTitle")} items={newest.data?.items ?? []} />

      {/* Brands marquee */}
      {topBrands.length > 0 && (
        <section className="overflow-hidden border-y border-border bg-secondary/20 py-6">
          <div className="mb-4 px-4 text-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t("popularBrandsTitle")}
          </div>
          <div className="relative flex overflow-hidden">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 animate-[marquee-scroll_28s_linear_infinite] gap-4 pr-4">
                {topBrands.map((brand) => (
                  <Link
                    key={`${copy}-${brand.id}`}
                    href={`/catalog?q=${encodeURIComponent(brand.name)}`}
                    className="flex min-w-[120px] items-center justify-center rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {brand.name}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Promotions */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="mx-auto max-w-7xl px-4 py-12"
      >
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">{t("promotionsTitle")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {localizedPromotions.map((promotion, i) => (
            <motion.div
              key={promotion.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <Link
                href={promotion.href}
                className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
              >
                <span className="mb-3 inline-block rounded-md bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">{promotion.badge}</span>
                <h3 className="font-heading text-lg font-bold text-foreground transition-colors group-hover:text-accent">{promotion.title}</h3>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{promotion.description}</p>
                <span className="mt-4 flex items-center gap-1 text-sm font-medium text-accent transition-all group-hover:gap-2">
                  {t("goTo")} <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Articles */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="mx-auto max-w-7xl px-4 py-12"
      >
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">{t("articlesTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {localizedArticles.map((article, i) => (
            <motion.div
              key={article.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <Link
                href={article.href}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <Image
                    src={article.image}
                    alt={article.title}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-black/5 to-transparent" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <span className="mb-2 inline-block w-fit rounded-md bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">
                    {article.category}
                  </span>
                  <h3 className="mb-2 font-heading text-base font-bold leading-relaxed text-foreground transition-colors group-hover:text-accent">
                    {article.title}
                  </h3>
                  <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{article.description}</p>
                  <span className="mt-auto flex items-center gap-1 text-sm font-medium text-accent transition-all group-hover:gap-2">
                    {t("readMore")} <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Popular tags */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="mx-auto max-w-7xl px-4 py-12"
      >
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">{t("popularQueriesTitle")}</h2>
        <div className="flex flex-wrap gap-2">
          {tagLinks.map((item) => (
            <Link
              key={item.tag}
              href={item.href}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent hover:shadow-md"
            >
              {item.tag}
            </Link>
          ))}
        </div>
      </motion.section>

      {/* Recently viewed */}
      {recentItems.length > 0 && (
        <motion.section
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mx-auto max-w-7xl px-4 py-12"
        >
          <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">{t("recentlyViewedTitle")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
            {recentItems.map((product) => {
              const imageUrl = normalizeImageUrl(recentImageById.get(product.id));
              return (
                <Link
                  key={product.id}
                  href={`/product/${product.slug}`}
                  className="group flex flex-col rounded-2xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
                >
                  <div className="relative aspect-square overflow-hidden rounded-t-2xl bg-secondary/30 p-4">
                    {imageUrl ? (
                      <Image src={imageUrl} alt={product.title} fill sizes="(min-width: 640px) 25vw, 50vw" className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <div className="h-16 w-16 rounded-xl bg-muted" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="mb-1 truncate text-sm font-medium text-foreground transition-colors group-hover:text-accent">
                      {product.title}
                    </h3>
                    <p className="text-sm font-bold text-accent">
                      {product.minPrice != null ? formatPrice(product.minPrice) : t("pricePending")}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </motion.section>
      )}

      <NewsletterSection />
    </div>
  );
}
