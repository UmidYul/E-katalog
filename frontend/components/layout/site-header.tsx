"use client";

import { GitCompareArrows, Heart, Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/common/theme-toggle";
import { useAuthMe } from "@/features/auth/use-auth";
import { useBrands, useCategories } from "@/features/catalog/use-catalog-queries";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { useCompareStore } from "@/store/compare.store";

const links = [
  { href: "/catalog", label: "Catalog" },
  { href: "/favorites", label: "Favorites" }
];

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const shouldLoadMe = pathname !== "/login" && pathname !== "/register";
  const me = useAuthMe(shouldLoadMe);
  const categories = useCategories();
  const brands = useBrands();
  const compareCountFromStore = useCompareStore((s) => s.items.length);
  const [query, setQuery] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
  }, [pathname]);

  const topCategories = useMemo(() => (hydrated ? (categories.data ?? []).slice(0, 8) : []), [categories.data, hydrated]);
  const virtualBrandCategories = useMemo(() => {
    if (!hydrated) return [];
    const source = brands.data ?? [];
    const bySlug = new Map<string, { slug: string; name: string; productsCount: number }>();
    for (const brand of source) {
      const slug = slugify(brand.name);
      if (!slug) continue;
      const productsCount = Number(brand.products_count ?? 0);
      const current = bySlug.get(slug);
      if (!current || productsCount > current.productsCount) {
        bySlug.set(slug, { slug, name: brand.name, productsCount });
      }
    }

    return Array.from(bySlug.values())
      .sort((left, right) => {
        if (right.productsCount !== left.productsCount) return right.productsCount - left.productsCount;
        return left.name.localeCompare(right.name);
      })
      .slice(0, 8)
      .map((brand) => ({
        href: `/category/brand-${brand.slug}`,
        label: `Brand - ${brand.name}`,
      }));
  }, [brands.data, hydrated]);
  const compareCount = hydrated ? compareCountFromStore : 0;
  const isLoginPage = pathname === "/login";
  const isAuthenticated = hydrated && Boolean(me.data?.id);
  const authLink = isAuthenticated ? { href: "/profile", label: "Profile" } : isLoginPage ? { href: "/register", label: "Register" } : { href: "/login", label: "Login" };

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = query.trim();
    router.push(next ? `/catalog?q=${encodeURIComponent(next)}` : "/catalog");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <span>ZincMarket</span>
        </Link>

        <form className="relative hidden flex-1 md:block" onSubmit={onSearchSubmit}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 pr-24" placeholder="Search products, brands..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-secondary">
            Search
          </button>
        </form>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
                pathname.startsWith(link.href) && "bg-secondary text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/compare"
            className={cn(
              "rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
              pathname.startsWith("/compare") && "bg-secondary text-foreground"
            )}
          >
            Compare{compareCount ? ` (${compareCount})` : ""}
          </Link>
          <Link
            href={authLink.href}
            className={cn(
              "rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
              pathname.startsWith(authLink.href) && "bg-secondary text-foreground"
            )}
          >
            {authLink.label}
          </Link>

          {topCategories.length ? (
            <div className="group relative">
              <button type="button" className="cursor-default rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors group-hover:bg-secondary group-hover:text-foreground">
                Categories
              </button>
              <div className="invisible absolute right-0 top-11 z-50 min-w-56 rounded-xl border border-border bg-card p-2 opacity-0 shadow-soft transition-all duration-150 group-hover:visible group-hover:opacity-100">
                {virtualBrandCategories.map((category) => (
                  <Link key={category.href} href={category.href} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    {category.label}
                  </Link>
                ))}
                {virtualBrandCategories.length ? <div className="my-1 border-t border-border" /> : null}
                {topCategories.map((category) => (
                  <Link key={category.id} href={`/category/${category.slug}`} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    {category.name}
                  </Link>
                ))}
                <Link href="/catalog" className="mt-1 block rounded-lg px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary">
                  View all categories
                </Link>
              </div>
            </div>
          ) : null}
        </nav>

        <Link href="/catalog" className="rounded-xl p-2 hover:bg-secondary md:hidden" aria-label="Open catalog search">
          <Search className="h-4 w-4" />
        </Link>
        <Link href="/compare" className="rounded-xl p-2 hover:bg-secondary md:hidden" aria-label="Open comparison">
          <GitCompareArrows className="h-4 w-4" />
        </Link>
        <Link href="/favorites" className="rounded-xl p-2 hover:bg-secondary md:hidden">
          <Heart className="h-4 w-4" />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}

