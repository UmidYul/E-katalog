"use client";

import { TrendingUp } from "lucide-react";
import Link from "next/link";

import { CatalogGrid } from "@/components/catalog/catalog-grid";
import { SectionHeading } from "@/components/common/section-heading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useCatalogProducts, useCategories } from "@/features/catalog/use-catalog-queries";
import { useRecentlyViewedStore } from "@/store/recentlyViewed.store";

const brands = ["Apple", "Samsung", "Xiaomi", "HP", "Lenovo", "Sony"];

export function HomeClient() {
  const trending = useCatalogProducts({ limit: 6, sort: "popular" });
  const categories = useCategories();
  const recent = useRecentlyViewedStore((s) => s.items.slice(0, 6));

  return (
    <div className="container space-y-12 py-6">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 shadow-soft">
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <Badge className="mb-4 w-fit bg-primary text-primary-foreground">Price Intelligence Platform</Badge>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-5xl">Find the best verified price across Uzbekistan stores in one search.</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">AI-normalized catalog, real-time comparisons, historical insights, and cleaner purchase decisions.</p>
        <div className="mt-6 flex gap-3">
          <Link href="/catalog" className="rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground">
            Start comparing
          </Link>
          <Link href="/register" className="rounded-2xl border border-border px-5 py-3 text-sm font-medium">
            Create account
          </Link>
        </div>
      </section>

      <section>
        <SectionHeading title="Trending products" description="Most viewed products this week" action={<TrendingUp className="h-5 w-5 text-primary" />} />
        <CatalogGrid loading={trending.isLoading} items={trending.data?.items ?? []} />
      </section>

      <section>
        <SectionHeading title="Categories" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {(categories.data ?? []).slice(0, 12).map((category) => (
            <Link key={category.id} href={`/category/${category.slug}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="p-4 text-sm font-medium">{category.name}</CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Popular brands" />
        <div className="flex flex-wrap gap-2">
          {brands.map((brand) => (
            <Badge key={brand} className="rounded-2xl px-4 py-2 text-sm">
              {brand}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Recently viewed" />
        {recent.length ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {recent.map((item) => (
              <Link key={item.id} href={`/product/${item.slug}`} className="rounded-2xl border border-border bg-card p-4 text-sm shadow-soft">
                {item.title}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recently viewed products yet.</p>
        )}
      </section>
    </div>
  );
}

