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

export function ProductCard({ product, favorite, onFavorite }: { product: ProductListItem; favorite?: boolean; onFavorite?: (id: number) => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <Card className="group overflow-hidden">
        <div className="relative aspect-[4/3] bg-muted/40">
          <Image
            src={product.image_url ?? "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80"}
            alt={product.normalized_title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
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
            <Badge className="bg-secondary/70">{product.store_count} stores</Badge>
          </div>
          <Link href={`/product/${product.id}-${slugify(product.normalized_title)}`} className="line-clamp-2 text-sm font-medium hover:text-primary">
            {product.normalized_title}
          </Link>
          <p className="text-lg font-semibold text-primary">{formatPrice(product.min_price ?? 0)}</p>
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

