"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Camera,
  Gamepad2,
  Grid3X3,
  Headphones,
  Heart,
  Laptop,
  Plus,
  Printer,
  Search,
  Smartphone,
  TrendingDown,
  Tv,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { useLocale } from "@/components/common/locale-provider";
import { useCatalogProducts, useCategories, useHomeTrustStats, usePriceDrops } from "@/features/catalog/use-catalog-queries";
import { catalogApi } from "@/lib/api/openapi-client";
import { formatPrice } from "@/lib/utils/format";
import type { ProductListItem } from "@/types/domain";

const categoryIcons = [Smartphone, Laptop, Tv, Headphones, Camera, Gamepad2, Printer, Grid3X3];

const partnerStores = ["MediaPark", "Texnomart", "Olcha", "Asaxiy", "Alif Shop", "Uzum Market"];

const slugify = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return normalized || "product";
};

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

const formatNumber = (value: number, locale: string) => new Intl.NumberFormat(locale).format(value);

function formatSyncLabel(timestamp: string | null | undefined, locale: string, isUz: boolean) {
  if (!timestamp) {
    return isUz ? "Нархлар янгиланиши кутилмо?да" : "Цены: обновление ожидается";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return isUz ? "Нархлар янгиланиши кутилмо?да" : "Цены: обновление ожидается";
  }

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const timePart = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (isToday) {
    return isUz ? `Нархлар бугун ${timePart} да янгиланди` : `Цены обновлены сегодня в ${timePart}`;
  }

  const datePart = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(date);
  return isUz ? `Нархлар ${datePart} ${timePart} да янгиланди` : `Цены обновлены ${datePart} в ${timePart}`;
}

function ProductScrollerSection({
  title,
  items,
  locale,
  storeLabel,
}: {
  title: string;
  items: ProductListItem[];
  locale: string;
  storeLabel: string;
}) {
  if (!items.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold text-foreground md:text-3xl">{title}</h2>
        <Link href="/catalog" className="text-sm font-semibold text-accent transition-colors hover:text-accent/80">
          {locale === "uz-Cyrl-UZ" ? "Барчасини кўриш" : "Смотреть все"}
        </Link>
      </div>
      <div className="scrollbar-hide -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
        {items.map((item) => {
          const slug = `${item.id}-${slugify(item.normalized_title)}`;
          const image = normalizeImageUrl(item.image_url);
          return (
            <motion.div key={item.id} whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}>
              <Link
                href={`/product/${slug}`}
                className="group relative flex min-w-[220px] shrink-0 flex-col rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="absolute right-3 top-3 z-10 flex gap-1.5">
                  <button
                    type="button"
                    onClick={(event) => event.preventDefault()}
                    className="rounded-full border border-border bg-background/90 p-1.5 text-muted-foreground backdrop-blur transition-colors hover:text-accent"
                    aria-label={locale === "uz-Cyrl-UZ" ? "Сараланганларга" : "В избранное"}
                  >
                    <Heart className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => event.preventDefault()}
                    className="rounded-full border border-border bg-background/90 p-1.5 text-muted-foreground backdrop-blur transition-colors hover:text-accent"
                    aria-label={locale === "uz-Cyrl-UZ" ? "Солиштиришга" : "В сравнение"}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
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
                      <div className="h-24 w-24 rounded-xl bg-muted" />
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="line-clamp-2 text-sm font-medium leading-relaxed text-foreground">{item.normalized_title}</h3>
                  <div className="mt-auto pt-3">
                    <div className="text-base font-bold text-accent">{formatPrice(item.min_price ?? 0)}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.store_count} {storeLabel}
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

function NewsletterSection({
  locale,
  title,
  text,
  placeholder,
  button,
  successText,
  options,
}: {
  locale: string;
  title: string;
  text: string;
  placeholder: string;
  button: string;
  successText: string;
  options: Array<{ id: string; label: string }>;
}) {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>(["all"]);

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      const categories = selected.includes("all") ? ["all"] : selected;
      return catalogApi.subscribeNewsletter({
        email: email.trim(),
        categories,
        locale,
      });
    },
  });

  const toggleOption = (value: string) => {
    setSelected((current) => {
      if (value === "all") return ["all"];
      const withoutAll = current.filter((item) => item !== "all");
      if (withoutAll.includes(value)) {
        const next = withoutAll.filter((item) => item !== value);
        return next.length ? next : ["all"];
      }
      return [...withoutAll, value];
    });
  };

  return (
    <section className="bg-accent">
      <div className="mx-auto max-w-7xl px-4 py-14">
        <div className="mx-auto max-w-2xl rounded-2xl border border-white/20 bg-white/10 p-6 text-white backdrop-blur">
          <h2 className="font-heading text-2xl font-bold md:text-3xl">{title}</h2>
          <p className="mt-2 text-sm text-white/80">{text}</p>

          {subscribeMutation.isSuccess ? (
            <div className="mt-5 rounded-xl bg-white/20 px-4 py-3 text-sm font-medium">{successText}</div>
          ) : (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (!email.trim()) return;
                subscribeMutation.mutate();
              }}
              className="mt-5 space-y-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={placeholder}
                  className="flex-1 rounded-xl bg-white/15 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/40"
                />
                <button
                  type="submit"
                  disabled={subscribeMutation.isPending}
                  className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-accent transition-opacity disabled:opacity-60"
                >
                  {subscribeMutation.isPending ? "..." : button}
                </button>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/80">
                  {locale === "uz-Cyrl-UZ" ? "Чегирмаларни истайман:" : "Хочу скидки на:"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {options.map((option) => {
                    const checked = selected.includes(option.id);
                    return (
                      <label
                        key={option.id}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          checked ? "border-white bg-white/20" : "border-white/35 bg-white/5"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOption(option.id)}
                          className="h-4 w-4 accent-white"
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {subscribeMutation.isError ? (
                <p className="text-sm text-red-100">
                  {locale === "uz-Cyrl-UZ"
                    ? "Обунада хатолик юз берди. Илтимос, ?айта уриниб кўринг."
                    : "Не удалось оформить подписку. Попробуйте ещё раз."}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

export function HomeClient() {
  const router = useRouter();
  const { locale } = useLocale();

  const isUz = locale === "uz-Cyrl-UZ";
  const intlLocale = isUz ? "uz-Cyrl-UZ" : "ru-RU";
  const tr = (ru: string, uz: string) => (isUz ? uz : ru);

  const [searchQuery, setSearchQuery] = useState("");

  const categories = useCategories();
  const trustStats = useHomeTrustStats();
  const priceDrops = usePriceDrops(8);
  const hits = useCatalogProducts({ limit: 8, sort: "popular" });
  const newest = useCatalogProducts({ limit: 8, sort: "newest" });

  const lastSyncQuery = useQuery({
    queryKey: ["home", "last-sync-proxy"],
    queryFn: async () => {
      const response = await fetch("/api/last-sync", { cache: "no-store" });
      if (!response.ok) return { timestamp: null as string | null };
      return (await response.json()) as { timestamp: string | null };
    },
    staleTime: 60_000,
  });

  const topCategories = useMemo(() => (categories.data ?? []).slice(0, 8), [categories.data]);
  const spotlightCategories = useMemo(() => topCategories.slice(0, 3), [topCategories]);

  const popularTags = useMemo(
    () =>
      isUz
        ? ["iPhone 15", "10 млн гача ноутбуклар", "4K телевизорлар", "Симсиз ?уло?чинлар"]
        : ["iPhone 15", "Ноутбуки до 10 млн", "4K ТВ", "Беспроводные наушники"],
    [isUz]
  );

  const newsletterOptions = [
    { id: "smartphones", label: tr("Смартфоны", "Смартфонлар") },
    { id: "laptops", label: tr("Ноутбуки", "Ноутбуклар") },
    { id: "tvs", label: tr("Телевизоры", "Телевизорлар") },
    { id: "all", label: tr("Всё", "Барчаси") },
  ];

  const productsCount = trustStats.data?.products_count ?? 0;
  const storesCount = trustStats.data?.stores_count ?? 0;
  const effectiveTimestamp = lastSyncQuery.data?.timestamp ?? trustStats.data?.timestamp;
  const syncLabel = formatSyncLabel(effectiveTimestamp, intlLocale, isUz);

  const productCountLabel = productsCount > 0 ? `${formatNumber(productsCount, intlLocale)}+` : "150 000+";
  const storeCountLabel = storesCount > 0 ? formatNumber(storesCount, intlLocale) : "45";

  return (
    <div className="min-h-screen bg-background">
      <section className="border-b border-border/70 bg-gradient-to-b from-accent/[0.08] via-accent/[0.03] to-transparent">
        <div className="mx-auto max-w-7xl px-4 py-12 md:py-16">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-balance font-heading text-3xl font-bold text-foreground md:text-5xl">
              {tr("Сравнивайте цены на технику в одном месте", "Техника нархларини битта жойда солиштиринг")}
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
              {tr(
                "Проверенные магазины, актуальные цены и быстрый поиск нужной модели.",
                "Текширилган дўконлар, долзарб нархлар ва керакли моделни тез ?идириш."
              )}
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const query = searchQuery.trim();
                if (!query) return;
                router.push(`/catalog?q=${encodeURIComponent(query)}`);
              }}
              className="mx-auto mt-6 flex max-w-3xl items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm"
            >
              <Search className="ml-2 h-5 w-5 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={tr(
                  "iPhone 15, Samsung TV, ноутбук для учёбы...",
                  "iPhone 15, Samsung TV, ў?иш учун ноутбук..."
                )}
                className="w-full bg-transparent px-1 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                aria-label={tr("Поиск по товарам", "Товарлар бўйича ?идириш")}
              />
              <button type="submit" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground">
                {tr("Найти", "?идириш")}
              </button>
            </form>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {popularTags.map((tag) => (
                <Link
                  key={tag}
                  href={`/catalog?q=${encodeURIComponent(tag)}`}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-accent/40 hover:text-accent"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-secondary/30">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex flex-col gap-2 text-sm text-foreground md:flex-row md:items-center md:justify-center md:gap-4">
            <span>
              <strong>{productCountLabel}</strong> {tr("товаров", "товар")}
            </span>
            <span className="hidden text-muted-foreground md:inline">·</span>
            <span>
              <strong>{storeCountLabel}</strong> {tr("проверенных магазинов", "текширилган дўкон")}
            </span>
            <span className="hidden text-muted-foreground md:inline">·</span>
            <span className="text-muted-foreground">{syncLabel}</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {tr("Цены из проверенных магазинов", "Нархлар текширилган дўконлардан")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {partnerStores.map((store) => (
            <div
              key={store}
              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm"
            >
              {store}
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="mb-5 font-heading text-2xl font-bold text-foreground md:text-3xl">
          {tr("Популярные категории", "Оммавий категориялар")}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {topCategories.map((category, index) => {
            const Icon = categoryIcons[index % categoryIcons.length] ?? Smartphone;
            const productsCountText = category.products_count ? formatNumber(category.products_count, intlLocale) : "0";
            return (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                className="group rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md"
              >
                <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-sm font-semibold text-foreground">{category.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{productsCountText}</div>
              </Link>
            );
          })}
          <Link
            href="/catalog"
            className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm font-semibold text-muted-foreground transition-colors hover:border-accent/40 hover:text-accent"
          >
            + {tr("все категории", "барча категориялар")}
          </Link>
        </div>
      </section>

      {priceDrops.data?.items?.length ? (
        <section className="mx-auto max-w-7xl px-4 py-8">
          <h2 className="mb-5 flex items-center gap-2 font-heading text-2xl font-bold text-foreground md:text-3xl">
            <TrendingDown className="h-6 w-6 text-emerald-600" />
            {tr("Подешевело сегодня", "Бугун арзонлади")}
          </h2>
          <div className="scrollbar-hide -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {priceDrops.data.items.map((item) => {
              const slug = `${item.id}-${slugify(item.normalized_title)}`;
              const image = normalizeImageUrl(item.image_url);
              const dropPercent = Math.max(1, Math.round(item.drop_pct));
              return (
                <Link
                  key={item.id}
                  href={`/product/${slug}`}
                  className="group flex min-w-[240px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="relative aspect-square bg-secondary/30 p-4">
                    {image ? (
                      <Image
                        src={image}
                        alt={item.normalized_title}
                        fill
                        className="object-contain p-2 transition-transform duration-300 group-hover:scale-105"
                        sizes="(max-width: 768px) 85vw, 240px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <div className="h-24 w-24 rounded-xl bg-muted" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-3">
                    <h3 className="line-clamp-2 text-sm font-medium text-foreground">{item.normalized_title}</h3>
                    <div className="mt-auto pt-3">
                      <div className="text-sm text-muted-foreground line-through">{formatPrice(item.old_price)}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-accent">{formatPrice(item.new_price)}</span>
                        <span className="text-sm font-semibold text-emerald-600">-{dropPercent}%</span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <ProductScrollerSection
        title={tr("Хиты продаж", "Сотув хитлари")}
        items={hits.data?.items ?? []}
        locale={locale}
        storeLabel={tr("магазинов", "дўкон")}
      />

      <ProductScrollerSection
        title={tr("Новинки", "Янги ма?сулотлар")}
        items={newest.data?.items ?? []}
        locale={locale}
        storeLabel={tr("магазинов", "дўкон")}
      />

      {spotlightCategories.length > 0 ? (
        <section className="mx-auto max-w-7xl px-4 py-10">
          <h2 className="mb-5 font-heading text-2xl font-bold text-foreground md:text-3xl">
            {tr("Подборки", "Оммавий тўпламлар")}
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {spotlightCategories.map((category, index) => {
              const Icon = categoryIcons[index % categoryIcons.length] ?? Smartphone;
              const productsCountText = category.products_count ? formatNumber(category.products_count, intlLocale) : "0";
              return (
                <Link
                  key={category.id}
                  href={`/category/${category.slug}`}
                  className="rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md"
                >
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-heading text-lg font-bold text-foreground">{category.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tr("Товаров в категории:", "Категориядаги товарлар:")} {productsCountText}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <NewsletterSection
        locale={locale}
        title={tr("Узнавайте о скидках первыми", "Чегирмалар ?а?ида биринчи бўлиб билинг")}
        text={tr(
          "Подпишитесь на email-рассылку и выберите категории, которые вам интересны.",
          "Email обунага ёзилинг ва сизга ?изи? бўлган категорияларни танланг."
        )}
        placeholder={tr("Ваш email", "Email манзилингиз")}
        button={tr("Подписаться", "Обуна бўлиш")}
        successText={tr("Спасибо за подписку!", "Обуна учун ра?мат!")}
        options={newsletterOptions}
      />
    </div>
  );
}

