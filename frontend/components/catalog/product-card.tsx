"use client";

import { motion } from "framer-motion";
import { Eye, Heart, Scale, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { PriceAlertBadge } from "@/components/common/price-alert-badge";
import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/utils/format";
import type { PriceAlertSignal, ProductListItem } from "@/types/domain";

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

interface ProductCardProps {
  product: ProductListItem;
  favorite?: boolean;
  onFavorite?: (id: string) => void;
  compared?: boolean;
  onCompare?: (id: string) => void;
  compareDisabled?: boolean;
  compareDisabledReason?: string;
  isTracking?: boolean;
  priceAlertSignal?: PriceAlertSignal | null;
}

export function ProductCard({
  product,
  favorite,
  onFavorite,
  compared,
  onCompare,
  compareDisabled,
  compareDisabledReason,
  priceAlertSignal,
}: ProductCardProps) {
  const productHref = `/product/${product.id}-${slugify(product.normalized_title)}`;
  const [heartBurst, setHeartBurst] = useState(false);

  const handleFavoriteClick = () => {
    setHeartBurst(true);
    setTimeout(() => setHeartBurst(false), 450);
    onFavorite?.(product.id);
  };

  // Derive a mock rating for display (real apps would pass this as prop)
  const displayRating = 4;
  const reviewCount = Math.max(12, Math.round((product.score ?? 0.4) * 180));
  const storeCount = product.store_count ?? 0;
  const storeLabel = storeCount === 1 ? "магазин" : storeCount < 5 ? "магазина" : "магазинов";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      whileHover={{ y: -4 }}
      className="group relative"
    >
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow duration-300 group-hover:shadow-md">
        {/* Image area */}
        <div className="relative aspect-square overflow-hidden bg-muted/30">
          <Link href={productHref} className="absolute inset-0" aria-label={product.normalized_title} tabIndex={-1}>
            <Image
              src={
                product.image_url && /^https?:\/\//.test(product.image_url)
                  ? product.image_url
                  : "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=800&q=80"
              }
              alt={product.normalized_title}
              fill
              className="object-contain p-4 transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          </Link>

          {/* Badges — top left */}
          <div className="absolute left-2 top-2 flex flex-col gap-1">
            {product.is_new && (
              <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">Н</span>
            )}
            {(product.discount_pct ?? 0) > 0 && (
              <span className="rounded-sm bg-success px-1.5 py-0.5 text-[10px] font-bold text-white">
                -{product.discount_pct}%
              </span>
            )}
          </div>

          {/* Action icons — appear on hover */}
          <div className="absolute right-2 top-2 flex flex-col gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {/* Favorite */}
            <motion.button
              type="button"
              onClick={handleFavoriteClick}
              animate={heartBurst ? { scale: [1, 1.4, 0.85, 1] } : {}}
              transition={{ duration: 0.4 }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md shadow-sm transition-colors",
                favorite
                  ? "bg-danger text-white"
                  : "bg-white text-muted-foreground hover:bg-danger/10 hover:text-danger"
              )}
              aria-label={favorite ? "Удалить из избранного" : "Добавить в избранное"}
            >
              <Heart className={cn("h-4 w-4", favorite && "fill-current")} />
            </motion.button>

            {/* Compare */}
            <button
              type="button"
              onClick={() => onCompare?.(product.id)}
              disabled={compareDisabled}
              title={compareDisabledReason}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md shadow-sm transition-colors",
                compared
                  ? "bg-accent text-white"
                  : "bg-white text-muted-foreground hover:bg-accent/10 hover:text-accent",
                compareDisabled && "cursor-not-allowed opacity-50"
              )}
              aria-label={compared ? "Убрать из сравнения" : "Добавить к сравнению"}
            >
              <Scale className="h-4 w-4" />
            </button>

            {/* Quick view */}
            <Link
              href={productHref}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-white shadow-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Быстрый просмотр"
            >
              <Eye className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col gap-2 p-3">
          {/* Alert badge */}
          <PriceAlertBadge signal={priceAlertSignal} />

          {/* Title */}
          <Link
            href={productHref}
            className="line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors hover:text-accent"
          >
            {product.normalized_title}
          </Link>

          {/* Rating */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }, (_, i) => (
                <Star
                  key={i}
                  className={cn(
                    "h-3 w-3",
                    i < displayRating ? "fill-amber-400 text-amber-400" : "fill-transparent text-border"
                  )}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">({reviewCount})</span>
          </div>

          {/* Price + stores */}
          <div className="mt-auto">
            <p className="text-xs text-muted-foreground">от</p>
            <p className="text-lg font-bold leading-tight text-accent">
              {formatPrice(product.min_price ?? 0)}
            </p>
            {storeCount > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                в {storeCount} {storeLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}


