"use client";

import { ProductCard } from "@/components/catalog/product-card";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useFavorites, useToggleFavorite } from "@/features/user/use-favorites";
import type { ProductListItem } from "@/types/domain";

export function CatalogGrid({ loading, items }: { loading: boolean; items: ProductListItem[] }) {
  const { data: favorites } = useFavorites();
  const toggle = useToggleFavorite();

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, idx) => (
          <Skeleton key={idx} className="h-[320px]" />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return <EmptyState title="No products found" message="Try changing filters or query." />;
  }

  const favoriteSet = new Set((favorites ?? []).map((x) => x.product_id));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <ProductCard key={item.id} product={item} favorite={favoriteSet.has(item.id)} onFavorite={(id) => toggle.mutate(id)} />
      ))}
    </div>
  );
}

