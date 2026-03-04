"use client";

import { useEffect, useMemo, useState } from "react";
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
import Image from "next/image";
import Link from "next/link";

import { useBrands, useCatalogProducts, useCategories } from "@/features/catalog/use-catalog-queries";
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
  },
  {
    category: "Подборка",
    title: "Лучшие смартфоны в популярных сегментах",
    description: "Сравниваем модели по камере, производительности и времени работы.",
    href: "/catalog?q=смартфон&sort=popular",
  },
  {
    category: "База знаний",
    title: "С чего начать настройку умного дома",
    description: "Короткий план по стартовым устройствам и связкам экосистем.",
    href: "/catalog?q=умный дом",
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

function HeroBanner() {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroSlides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + heroSlides.length) % heroSlides.length);
  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % heroSlides.length);

  return (
    <section className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex gap-4">
        <div className="relative flex-1 overflow-hidden rounded-xl border border-border/40">
          <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${currentSlide * 100}%)` }}>
            {heroSlides.map((slide) => (
              <div key={slide.title} className={`flex min-w-full flex-col justify-center bg-gradient-to-br ${slide.bgClass} px-8 py-16 md:px-14 md:py-20`}>
                <span className="mb-2 inline-block w-fit rounded-full bg-accent/25 px-3 py-1 text-xs font-semibold text-accent">
                  {slide.subtitle}
                </span>
                <h1 className="mb-3 text-balance font-heading text-3xl font-bold text-primary-foreground md:text-5xl">{slide.title}</h1>
                <p className="mb-6 max-w-xl text-sm text-primary-foreground/80 md:text-base">{slide.description}</p>
                <Link
                  href={slide.href}
                  className="inline-flex w-fit items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-all hover:scale-[1.02] hover:opacity-90"
                >
                  {slide.cta}
                </Link>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={prevSlide}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-card/20 p-2 text-primary-foreground backdrop-blur-sm transition-colors hover:bg-card/35"
            aria-label="Предыдущий слайд"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={nextSlide}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-card/20 p-2 text-primary-foreground backdrop-blur-sm transition-colors hover:bg-card/35"
            aria-label="Следующий слайд"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
            {heroSlides.map((slide, index) => (
              <button
                type="button"
                key={slide.title}
                onClick={() => setCurrentSlide(index)}
                className={`h-2 rounded-full transition-all ${index === currentSlide ? "w-6 bg-accent" : "w-2 bg-primary-foreground/45"}`}
                aria-label={`Слайд ${index + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="hidden w-64 flex-col gap-4 lg:flex">
          {sideHeroCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className={`flex flex-1 flex-col justify-end rounded-xl border border-border/40 bg-gradient-to-br ${card.bgClass} p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_hsl(var(--primary)/0.08)]`}
            >
              <h2 className="font-heading text-lg font-bold text-primary-foreground">{card.title}</h2>
              <p className="mt-1 text-sm text-primary-foreground/75">{card.subtitle}</p>
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
  const image = isImageUrl(item.image_url) ? item.image_url : null;

  return (
    <Link
      href={`/product/${slug}`}
      className="group flex min-w-[220px] shrink-0 flex-col rounded-xl border border-border bg-card shadow-[0_2px_10px_hsl(var(--primary)/0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_hsl(var(--primary)/0.08)]"
    >
      <div className="relative aspect-square overflow-hidden rounded-t-xl bg-card p-4">
        {image ? (
          <Image
            src={image}
            alt={item.normalized_title}
            fill
            className="object-contain p-2 transition-transform duration-300 group-hover:scale-[1.03]"
            sizes="(max-width: 768px) 85vw, 220px"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="h-24 w-24 rounded-lg bg-muted sm:h-28 sm:w-28" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="mb-2 line-clamp-2 text-sm font-medium leading-relaxed text-foreground">{item.normalized_title}</h3>
        <div className="mb-2 flex items-center gap-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <Star key={index} className={`h-3.5 w-3.5 ${index < 4 ? "fill-[#F59E0B] text-[#F59E0B]" : "text-border"}`} />
          ))}
          <span className="ml-1 text-xs text-muted-foreground">({reviews})</span>
        </div>
        <div className="mt-auto">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-foreground">{formatPrice(item.min_price ?? 0)}</span>
            {hasOldPrice ? <span className="text-sm text-muted-foreground line-through">{formatPrice(item.max_price ?? 0)}</span> : null}
          </div>
          <span className="mt-1 block text-xs text-muted-foreground">
            {item.store_count} {item.store_count === 1 ? "магазин" : "магазинов"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function ProductSection({ title, items }: { title: string; items: ProductListItem[] }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold text-foreground md:text-3xl">{title}</h2>
        <Link href="/catalog" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:gap-2">
          Смотреть все
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="scrollbar-hide -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
        {items.length ? items.map((item) => <ProductCard key={item.id} item={item} />) : <p className="text-sm text-muted-foreground">Загрузка товаров...</p>}
      </div>
    </section>
  );
}

function NewsletterSection() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <section className="bg-primary">
      <div className="mx-auto max-w-7xl px-4 py-14">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="mb-3 font-heading text-2xl font-bold text-primary-foreground md:text-3xl">Узнавайте о скидках первыми</h2>
          <p className="mb-6 text-sm text-primary-foreground/70">
            Подпишитесь на рассылку и получайте лучшие предложения и подборки в одном письме.
          </p>
          {submitted ? (
            <div className="rounded-lg bg-success/20 px-4 py-3 text-sm font-medium text-success">Спасибо за подписку.</div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (email.trim()) setSubmitted(true);
              }}
              className="flex gap-2"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Ваш email"
                className="flex-1 rounded-lg bg-primary-foreground/10 px-4 py-3 text-sm text-primary-foreground placeholder:text-primary-foreground/45 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="submit"
                className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition-all hover:opacity-90 active:scale-[0.98]"
              >
                Подписаться
              </button>
            </form>
          )}
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

export function HomeClient() {
  const categories = useCategories();
  const brands = useBrands();
  const popular = useCatalogProducts({ limit: 8, sort: "popular" });
  const newest = useCatalogProducts({ limit: 8, sort: "newest" });
  const recentItems = useRecentlyViewedStore((state) => state.items).slice(0, 4);

  const topCategories = useMemo(() => (categories.data ?? []).slice(0, 8), [categories.data]);
  const topBrands = useMemo(() => (brands.data ?? []).slice(0, 10), [brands.data]);
  const tagLinks = tags.map((tag) => ({ tag, href: `/catalog?q=${encodeURIComponent(tag)}` }));

  return (
    <div className="min-h-screen bg-background">
      <HeroBanner />

      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">Выберите технику</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:gap-4">
          {topCategories.map((category, index) => {
            const Icon = categoryIcons[index % categoryIcons.length] ?? Smartphone;
            return (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-5 text-center shadow-[0_2px_10px_hsl(var(--primary)/0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_10px_20px_hsl(var(--primary)/0.08)]"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary transition-colors group-hover:bg-accent/10">
                  <Icon className="h-7 w-7 text-accent" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{category.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Категория каталога</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <ProductSection title="Хиты продаж" items={popular.data?.items ?? []} />
      <ProductSection title="Новинки" items={newest.data?.items ?? []} />

      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">Популярные бренды</h2>
        <div className="scrollbar-hide -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:grid md:grid-cols-5 md:gap-4 lg:grid-cols-10">
          {topBrands.map((brand) => (
            <Link
              key={brand.id}
              href={`/category/brand-${slugify(brand.name)}`}
              className="flex min-w-[100px] shrink-0 items-center justify-center rounded-xl border border-border bg-card px-4 py-5 text-sm font-semibold text-muted-foreground shadow-[0_2px_10px_hsl(var(--primary)/0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent hover:shadow-[0_10px_20px_hsl(var(--primary)/0.08)]"
            >
              {brand.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">Акции</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {promotions.map((promotion) => (
            <Link
              key={promotion.title}
              href={promotion.href}
              className="rounded-xl border border-border bg-card p-5 shadow-[0_2px_10px_hsl(var(--primary)/0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_hsl(var(--primary)/0.08)]"
            >
              <span className="mb-3 inline-block rounded-md bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">{promotion.badge}</span>
              <h3 className="font-heading text-lg font-bold text-foreground">{promotion.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{promotion.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">Советы и подборки</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => (
            <Link
              key={article.title}
              href={article.href}
              className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_2px_10px_hsl(var(--primary)/0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_hsl(var(--primary)/0.08)]"
            >
              <div className="aspect-[16/10] bg-card" />
              <div className="flex flex-1 flex-col p-4">
                <span className="mb-2 inline-block w-fit rounded-md bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">{article.category}</span>
                <h3 className="mb-2 font-heading text-base font-bold leading-relaxed text-foreground transition-colors group-hover:text-accent">{article.title}</h3>
                <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{article.description}</p>
                <span className="mt-auto flex items-center gap-1 text-sm font-medium text-accent transition-all group-hover:gap-2">
                  Читать
                  <ArrowRight className="h-4 w-4" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {advantages.map((item) => (
            <div key={item.title} className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-5 text-center shadow-[0_2px_10px_hsl(var(--primary)/0.05)]">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
                <item.icon className="h-6 w-6 text-accent" />
              </div>
              <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">Популярные запросы</h2>
        <div className="flex flex-wrap gap-2">
          {tagLinks.map((item) => (
            <Link
              key={item.tag}
              href={item.href}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground shadow-[0_2px_10px_hsl(var(--primary)/0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent hover:shadow-[0_10px_20px_hsl(var(--primary)/0.08)]"
            >
              {item.tag}
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="mb-6 font-heading text-2xl font-bold text-foreground md:text-3xl">Недавно просмотренные</h2>
        {recentItems.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
            {recentItems.map((product) => (
              <Link
                key={product.id}
                href={`/product/${product.slug}`}
                className="group flex flex-col rounded-xl border border-border bg-card shadow-[0_2px_10px_hsl(var(--primary)/0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_hsl(var(--primary)/0.08)]"
              >
                <div className="aspect-square rounded-t-xl bg-card p-4">
                  <div className="flex h-full items-center justify-center">
                    <div className="h-16 w-16 rounded-lg bg-muted" />
                  </div>
                </div>
                <div className="p-3">
                  <h3 className="mb-1 truncate text-sm font-medium text-foreground transition-colors group-hover:text-accent">{product.title}</h3>
                  <p className="text-sm font-bold text-foreground">{product.minPrice != null ? formatPrice(product.minPrice) : "Цена уточняется"}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Здесь появятся товары, которые вы недавно открывали.</p>
        )}
      </section>

      <NewsletterSection />
    </div>
  );
}
