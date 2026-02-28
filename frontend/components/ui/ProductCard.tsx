"use client";

import { motion } from "framer-motion";
import { Heart, Scale, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { PriceAlertBadge } from "@/components/common/price-alert-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/utils/format";
import type { PriceAlertSignal, ProductListItem } from "@/types/domain";

export function ProductCard({
  product,
  favorite,
  onFavorite,
  compared,
  onCompare,
  compareDisabled,
  compareDisabledReason,
  isTracking,
  priceAlertSignal
}: {
  product: ProductListItem;
  favorite?: boolean;
  onFavorite?: (id: string) => void;
  compared?: boolean;
  onCompare?: (id: string) => void;
  compareDisabled?: boolean;
  compareDisabledReason?: string;
  isTracking?: boolean;
  priceAlertSignal?: PriceAlertSignal | null;
}) {
  const storesLabel = product.store_count === 1 ? "магазин" : "магазинов";
  const hasPriceComparison = product.store_count >= 2;
  const hasPriceRange =
    product.min_price != null && product.max_price != null && product.max_price > product.min_price;
  const productHref = `/product/${product.id}-${slugify(product.normalized_title)}`;

  const rating = typeof product.score === "number" ? Math.max(0, Math.min(5, product.score)) : null;
  const hasDiscountSignal =
    Boolean(priceAlertSignal?.is_drop) || Boolean(priceAlertSignal?.is_target_hit);
  const discountPct =
    hasDiscountSignal && typeof priceAlertSignal?.drop_pct === "number"
      ? Math.round(priceAlertSignal.drop_pct)
      : null;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="card-base card-hover group relative flex h-full flex-col overflow-hidden">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/40">
          <Link
            href={productHref}
            className="absolute inset-0 block"
            aria-label={product.normalized_title}
          >
            <Image
              src={
                product.image_url ??
                "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80"
              }
              alt={product.normalized_title}
              fill
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            />
          </Link>

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/40 via-transparent to-background/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          {discountPct !== null ? (
            <div className="absolute left-3 top-3 z-10">
              <span className="badge-discount shadow-sm">-{discountPct}%</span>
            </div>
          ) : null}

          <Button
            variant={favorite ? "default" : "secondary"}
            size="icon"
            className="absolute right-3 top-3 z-10 h-9 w-9 rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background"
            onClick={() => onFavorite?.(product.id)}
            aria-label={favorite ? "Убрать из избранного" : "Добавить в избранное"}
          >
            <Heart className={cn("h-4 w-4", favorite && "fill-current")} />
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2 text-xs">
            {product.brand?.name ? (
              <Badge className="rounded-full border-border/60 bg-secondary/70 px-2 py-0.5 text-[11px] font-medium">
                {product.brand.name}
              </Badge>
            ) : (
              <span className="text-[11px] text-muted-foreground">Техника</span>
            )}
            {hasPriceComparison ? (
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                Есть сравнение цен
              </span>
            ) : null}
          </div>

          <div className="space-y-1">
            <Link
              href={productHref}
              className="line-clamp-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              {product.normalized_title}
            </Link>

            {rating !== null ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-0.5 text-amber-400">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      className={cn(
                        "h-3.5 w-3.5",
                        index < Math.round(rating) ? "fill-current" : "opacity-30"
                      )}
                    />
                  ))}
                </div>
                <span className="text-[11px]">
                  {rating.toFixed(1)} ·{" "}
                  <span className="text-muted-foreground/80">оценок пока немного</span>
                </span>
              </div>
            ) : null}
          </div>

          {isTracking ? (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
              Отслеживается
            </span>
          ) : null}

          <PriceAlertBadge signal={priceAlertSignal} />

          <div className="mt-auto flex items-end justify-between gap-2 pt-1">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">от</p>
              <p className="price-tag text-xl leading-none">
                {formatPrice(product.min_price ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">
                {product.store_count} {storesLabel}
              </p>
              {hasPriceRange ? (
                <p className="text-[11px] text-muted-foreground">
                  до {formatPrice(product.max_price ?? 0)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <Link
                  href={productHref}
                  className="gradient-primary inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-sm"
                >
                  Смотреть
                </Link>
                <Button
                  size="icon"
                  variant={compared ? "default" : "outline"}
                  onClick={() => onCompare?.(product.id)}
                  disabled={compareDisabled}
                  title={compareDisabled ? compareDisabledReason : undefined}
                  className="h-8 w-8 rounded-full border-border/80 text-foreground"
                >
                  <Scale className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

