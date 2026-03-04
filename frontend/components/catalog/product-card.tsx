"use client";

import { motion } from "framer-motion";
import { Heart, Scale } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { PriceAlertBadge } from "@/components/common/price-alert-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  priceAlertSignal,
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
  const hasPriceRange = product.min_price != null && product.max_price != null && product.max_price > product.min_price;
  const productHref = `/product/${product.id}-${slugify(product.normalized_title)}`;

  return (
    <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <div className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
        <div className="relative aspect-[4/3] bg-secondary/70 p-2">
          <Link href={productHref} className="absolute inset-0 block" aria-label={product.normalized_title}>
            <Image
              src={product.image_url ?? "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80"}
              alt={product.normalized_title}
              fill
              className="object-contain p-2 transition-transform duration-300 group-hover:scale-[1.03]"
              sizes="(max-width: 768px) 100vw, 30vw"
            />
          </Link>
          <Button
            variant={favorite ? "default" : "secondary"}
            size="icon"
            className="absolute right-2 top-2 z-10 h-8 w-8 rounded-full"
            onClick={() => onFavorite?.(product.id)}
            aria-label="Добавить в избранное"
          >
            <Heart className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
          </Button>
        </div>
        <div className="space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {product.brand?.name ? <Badge>{product.brand.name}</Badge> : null}
            <Badge className="bg-secondary">
              {product.store_count} {storesLabel}
            </Badge>
            {hasPriceComparison ? <Badge className="bg-accent/10 text-accent">Сравнение</Badge> : null}
          </div>

          {isTracking ? <Badge className="border-primary/40 bg-primary/15 text-primary">Отслеживается</Badge> : null}
          <PriceAlertBadge signal={priceAlertSignal} />

          <Link href={productHref} className="line-clamp-2 min-h-10 text-sm font-semibold leading-relaxed hover:text-accent">
            {product.normalized_title}
          </Link>
          {hasPriceRange ? (
            <p className="text-xs text-muted-foreground">
              Диапазон: {formatPrice(product.min_price ?? 0)} - {formatPrice(product.max_price ?? 0)}
            </p>
          ) : null}
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Минимальная цена</p>
              <p className="text-lg font-bold text-foreground">{formatPrice(product.min_price ?? 0)}</p>
            </div>
            <Button
              size="sm"
              variant={compared ? "default" : "accent"}
              onClick={() => onCompare?.(product.id)}
              disabled={compareDisabled}
              title={compareDisabled ? compareDisabledReason : undefined}
              className="gap-1"
            >
              <Scale className="h-4 w-4" />
              {compared ? "В сравнении" : "Сравнить"}
            </Button>
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
