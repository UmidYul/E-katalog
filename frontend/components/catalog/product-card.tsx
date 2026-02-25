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
  const hasPriceRange = product.min_price != null && product.max_price != null && product.max_price > product.min_price;

  return (
    <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <div className="group overflow-hidden rounded-2xl border border-border/80 bg-card shadow-soft">
        <div className="relative aspect-[4/3] bg-muted/35 p-2">
          <Image
            src={product.image_url ?? "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80"}
            alt={product.normalized_title}
            fill
            className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            sizes="(max-width: 768px) 100vw, 30vw"
          />
          <Button variant={favorite ? "default" : "secondary"} size="icon" className="absolute right-3 top-3 h-9 w-9" onClick={() => onFavorite?.(product.id)} aria-label="Добавить в избранное">
            <Heart className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
          </Button>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {product.brand?.name ? <Badge>{product.brand.name}</Badge> : null}
            <Badge className="bg-secondary/70">
              {product.store_count} {storesLabel}
            </Badge>
            {hasPriceComparison ? <Badge className="border-success/40 bg-success/15 text-success">Есть сравнение цен</Badge> : null}
          </div>

          {isTracking ? <Badge className="border-primary/40 bg-primary/15 text-primary">Отслеживается</Badge> : null}
          <PriceAlertBadge signal={priceAlertSignal} />

          <Link href={`/product/${product.id}-${slugify(product.normalized_title)}`} className="line-clamp-2 text-sm font-semibold hover:text-primary">
            {product.normalized_title}
          </Link>
          {hasPriceRange ? (
            <p className="text-xs text-muted-foreground">
              Диапазон: {formatPrice(product.min_price ?? 0)} - {formatPrice(product.max_price ?? 0)}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Минимальная цена</p>
              <p className="text-lg font-extrabold text-primary">{formatPrice(product.min_price ?? 0)}</p>
            </div>
            <Button
              size="sm"
              variant={compared ? "default" : "outline"}
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
