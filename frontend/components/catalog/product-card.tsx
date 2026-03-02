"use client";

import { motion } from "framer-motion";
import { Heart, Scale } from "lucide-react";
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
  const hasPriceRange = product.min_price != null && product.max_price != null && product.max_price > product.min_price;
  const productHref = `/product/${product.id}-${slugify(product.normalized_title)}`;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="group relative"
    >
      <div className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card p-4 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/10">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-secondary/30">
          <Link href={productHref} className="block h-full w-full">
            <Image
              src={product.image_url ?? "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80"}
              alt={product.normalized_title}
              fill
              className="object-contain p-4 transition-transform duration-500 group-hover:scale-110"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </Link>

          <div className="absolute right-3 top-3 flex flex-col gap-2 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 translate-x-4">
            <Button
              variant={favorite ? "default" : "secondary"}
              size="icon"
              className={cn(
                "h-10 w-10 rounded-xl shadow-lg transition-all active:scale-95",
                favorite ? "bg-primary text-white" : "bg-white/80 backdrop-blur-md text-foreground hover:bg-white"
              )}
              onClick={() => onFavorite?.(product.id)}
            >
              <Heart className={cn("h-5 w-5", favorite && "fill-current")} />
            </Button>
            <Button
              variant={compared ? "default" : "secondary"}
              size="icon"
              className={cn(
                "h-10 w-10 rounded-xl shadow-lg transition-all active:scale-95",
                compared ? "bg-primary text-white" : "bg-white/80 backdrop-blur-md text-foreground hover:bg-white"
              )}
              onClick={() => onCompare?.(product.id)}
              disabled={compareDisabled}
              title={compareDisabled ? compareDisabledReason : "Добавить к сравнению"}
            >
              <Scale className="h-5 w-5" />
            </Button>
          </div>

          {priceAlertSignal?.is_drop && (
            <div className="absolute left-3 top-3">
              <Badge className="bg-emerald-500 text-white border-none shadow-lg shadow-emerald-500/20 px-3 py-1 font-black">
                -{priceAlertSignal.drop_pct.toFixed(0)}%
              </Badge>
            </div>
          )}
        </div>

        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1.5 overflow-hidden">
              {product.brand?.name && (
                <Badge className="bg-secondary/50 text-[10px] uppercase font-black tracking-wider text-muted-foreground whitespace-nowrap">
                  {product.brand.name}
                </Badge>
              )}
            </div>
            <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap">
              {product.store_count} {storesLabel}
            </span>
          </div>

          <Link href={productHref} className="block min-h-[40px]">
            <h3 className="line-clamp-2 text-sm font-bold leading-tight decoration-primary/30 transition-all group-hover:text-primary">
              {product.normalized_title}
            </h3>
          </Link>

          <div className="flex items-end justify-between gap-2 pt-2 border-t border-border/50">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Лучшая цена</p>
              <p className="bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-xl font-[900] text-transparent">
                {formatPrice(product.min_price ?? 0)}
              </p>
            </div>

            <Link
              href={productHref}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/5 text-primary transition-all hover:bg-primary hover:text-white"
            >
              →
            </Link>
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
