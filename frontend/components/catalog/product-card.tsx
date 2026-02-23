"use client";

import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils/format";
import type { ProductListItem } from "@/types/domain";

export function ProductCard({
  product,
  favorite,
  onFavorite,
  compared,
  onCompare,
  compareDisabled,
  compareDisabledReason
}: {
  product: ProductListItem;
  favorite?: boolean;
  onFavorite?: (id: string) => void;
  compared?: boolean;
  onCompare?: (id: string) => void;
  compareDisabled?: boolean;
  compareDisabledReason?: string;
}) {
  const storesLabel = product.store_count === 1 ? "store" : "stores";
  const hasPriceComparison = product.store_count >= 2;
  const hasPriceRange = product.min_price != null && product.max_price != null && product.max_price > product.min_price;

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <Card className="group overflow-hidden">
        <div className="relative aspect-[4/3] bg-muted/30 p-2">
          <Image
            src={product.image_url ?? "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80"}
            alt={product.normalized_title}
            fill
            className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            sizes="(max-width: 768px) 100vw, 30vw"
          />
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-3 top-3"
            onClick={() => onFavorite?.(product.id)}
            aria-label="Toggle favorite"
          >
            <Heart className={`h-4 w-4 ${favorite ? "fill-current text-primary" : "text-foreground"}`} />
          </Button>
        </div>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {product.brand?.name ? <Badge>{product.brand.name}</Badge> : null}
            <Badge className="bg-secondary/70">{product.store_count} {storesLabel}</Badge>
            {hasPriceComparison ? (
              <Badge className="bg-emerald-100 text-emerald-700">Price comparison</Badge>
            ) : null}
          </div>
          <Link href={`/product/${product.id}-${slugify(product.normalized_title)}`} className="line-clamp-2 text-sm font-medium hover:text-primary">
            {product.normalized_title}
          </Link>
          {hasPriceRange ? (
            <p className="text-xs text-muted-foreground">
              {formatPrice(product.min_price ?? 0)} - {formatPrice(product.max_price ?? 0)}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <p className="text-lg font-semibold text-primary">{formatPrice(product.min_price ?? 0)}</p>
            <Button
              size="sm"
              variant={compared ? "default" : "outline"}
              onClick={() => onCompare?.(product.id)}
              disabled={compareDisabled}
              title={compareDisabled ? compareDisabledReason : undefined}
            >
              {compared ? "Compared" : "Compare"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

