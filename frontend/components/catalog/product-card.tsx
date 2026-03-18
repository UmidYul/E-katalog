"use client";

import { Heart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { useLocale } from "@/components/common/locale-provider";
import { cn } from "@/lib/utils/cn";
import type { ProductListItem, ProductOffer } from "@/types/domain";

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const formatSum = (value: number | null | undefined) => `${new Intl.NumberFormat("uz-Cyrl-UZ").format(Number(value ?? 0))} сум`;

const normalizeImage = (value: string | undefined) => {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("/")) return normalized;
  return null;
};

type ProductCardProps = {
  product: ProductListItem;
  favorite: boolean;
  onFavorite: (id: string) => void;
  compared: boolean;
  onCompare: (id: string) => void;
  compareDisabled?: boolean;
  compareDisabledReason?: string;
};

export function ProductCard({ product, favorite, onFavorite, compared, onCompare, compareDisabled, compareDisabledReason }: ProductCardProps) {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const href = `/product/${product.id}-${slugify(product.normalized_title)}`;
  const image = normalizeImage(product.image_url);

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={() => onFavorite(product.id)}
        className={cn(
          "absolute right-3 top-3 z-10 rounded-full border border-border bg-background/90 p-2 backdrop-blur transition-colors",
          favorite ? "text-rose-600" : "text-muted-foreground hover:text-rose-600"
        )}
        aria-label={isUz ? "Сараланганларга" : "В избранное"}
      >
        <Heart className={cn("h-4 w-4", favorite ? "fill-current" : "")} />
      </button>

      {product.price_drop_pct && product.price_drop_pct > 0 ? (
        <span className="absolute left-3 top-3 z-10 rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
          ↓ {Math.round(product.price_drop_pct)}%
        </span>
      ) : null}

      <Link href={href} className="relative block aspect-square overflow-hidden bg-secondary/30 p-4">
        {image ? (
          <Image
            src={image}
            alt={product.normalized_title}
            fill
            sizes="(max-width: 768px) 85vw, 280px"
            className="object-contain p-2 transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Rasm yo‘q</div>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-3">
        <Link href={href} className="line-clamp-2 text-sm font-medium leading-5 text-foreground hover:text-accent">
          {product.normalized_title}
        </Link>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-base font-bold text-accent">{isUz ? "дан" : "от"} {formatSum(product.min_price)}</p>
            <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              {product.store_count} {isUz ? "дўкон" : "магазина"}
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <label
            title={compareDisabledReason}
            className={cn(
              "inline-flex items-center gap-2 text-xs",
              compareDisabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-foreground"
            )}
          >
            <input
              type="checkbox"
              checked={compared}
              disabled={compareDisabled}
              onChange={() => onCompare(product.id)}
              className="h-4 w-4 rounded border-border"
            />
            {isUz ? "Солиштириш" : "Сравнить"}
          </label>
        </div>
      </div>
    </article>
  );
}

type ProductListRowProps = ProductCardProps & {
  offers?: ProductOffer[];
};

export function ProductListRow({ product, favorite, onFavorite, compared, onCompare, compareDisabled, compareDisabledReason, offers }: ProductListRowProps) {
  const { locale } = useLocale();
  const isUz = locale === "uz-Cyrl-UZ";
  const href = `/product/${product.id}-${slugify(product.normalized_title)}`;
  const image = normalizeImage(product.image_url);

  return (
    <article className="grid gap-4 rounded-2xl border border-border bg-card p-3 shadow-sm md:grid-cols-[180px_minmax(0,1fr)_280px]">
      <Link href={href} className="relative block aspect-square overflow-hidden rounded-xl bg-secondary/30 p-3">
        {image ? (
          <Image src={image} alt={product.normalized_title} fill sizes="180px" className="object-contain p-2" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Rasm yo‘q</div>
        )}
      </Link>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-start justify-between gap-3">
          <Link href={href} className="line-clamp-2 text-base font-semibold text-foreground hover:text-accent">
            {product.normalized_title}
          </Link>
          <button
            type="button"
            onClick={() => onFavorite(product.id)}
            className={cn(
              "rounded-full border border-border bg-background/90 p-2 transition-colors",
              favorite ? "text-rose-600" : "text-muted-foreground hover:text-rose-600"
            )}
            aria-label={isUz ? "Сараланганларга" : "В избранное"}
          >
            <Heart className={cn("h-4 w-4", favorite ? "fill-current" : "")} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">
            {product.store_count} {isUz ? "дўкон" : "магазина"}
          </span>
          {product.price_drop_pct && product.price_drop_pct > 0 ? (
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
              ↓ {Math.round(product.price_drop_pct)}%
            </span>
          ) : null}
          {product.is_new ? <span className="rounded-full bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">Yangi</span> : null}
        </div>

        <div className="mt-auto pt-4">
          <label
            title={compareDisabledReason}
            className={cn(
              "inline-flex items-center gap-2 text-sm",
              compareDisabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-foreground"
            )}
          >
            <input
              type="checkbox"
              checked={compared}
              disabled={compareDisabled}
              onChange={() => onCompare(product.id)}
              className="h-4 w-4 rounded border-border"
            />
            {isUz ? "Солиштириш" : "Сравнить"}
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-secondary/20 p-3">
        <p className="text-sm text-muted-foreground">{isUz ? "Дўконлар нархи" : "Цены магазинов"}</p>
        <p className="mt-1 text-lg font-bold text-accent">{isUz ? "дан" : "от"} {formatSum(product.min_price)}</p>

        {offers?.length ? (
          <ul className="mt-3 space-y-1.5 text-sm">
            {offers.slice(0, 4).map((offer) => (
              <li key={offer.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-muted-foreground">{offer.seller_name}</span>
                <span className="font-semibold text-foreground">{formatSum(offer.price_amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{isUz ? "Нархлар юкланмоқда..." : "Загрузка цен..."}</p>
        )}
      </div>
    </article>
  );
}
