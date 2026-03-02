"use client";

import { Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/common/theme-toggle";
import { Input } from "@/components/ui/input";
import { useAuthMe } from "@/features/auth/use-auth";
import { useBrands, useCategories } from "@/features/catalog/use-catalog-queries";
import { cn } from "@/lib/utils/cn";
import { useCompareStore } from "@/store/compare.store";

const links = [
  { href: "/catalog", label: "Каталог" },
  { href: "/favorites", label: "Избранное" }
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
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
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
        label: `Бренд: ${brand.name}`
      }));
  }, [brands.data, hydrated]);
  const compareCount = hydrated ? compareCountFromStore : 0;
  const isLoginPage = pathname === "/login";
  const isAuthenticated = hydrated && Boolean(me.data?.id);
  const authLink = isAuthenticated
    ? { href: "/profile", label: "Профиль" }
    : isLoginPage
      ? { href: "/register", label: "Регистрация" }
      : { href: "/login", label: "Войти" };

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = query.trim();
    router.push(next ? `/catalog?q=${encodeURIComponent(next)}` : "/catalog");
  };

  return (
    <header className={cn(
      "sticky top-0 z-40 transition-all duration-300",
      isScrolled ? "h-16 border-b border-border bg-background/80 backdrop-blur-xl shadow-md" : "h-20 bg-transparent"
    )}>
      <div className="container flex h-full items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-heading text-2xl font-[900] tracking-tighter">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/30">
            <ShoppingBag className="h-4 w-4 text-white" />
          </div>
          <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">Doxx</span>
        </Link>

        <form className="relative hidden max-w-md flex-1 lg:block" onSubmit={onSearchSubmit}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            className="h-10 rounded-xl border-none bg-secondary/50 pl-10 pr-20 transition-all focus-visible:bg-background focus-visible:ring-primary/20"
            placeholder="Поиск по 10 000+ товаров..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-background px-1.5 font-sans text-[10px] font-medium text-muted-foreground">
            Enter
          </kbd>
        </form>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-bold text-foreground/70 transition-all hover:bg-secondary hover:text-foreground",
                pathname.startsWith(link.href) && "text-primary bg-primary/5"
              )}
            >
              {link.label}
            </Link>
          ))}

          <Link
            href="/compare"
            className={cn(
              "relative rounded-xl px-4 py-2 text-sm font-bold text-foreground/70 transition-all hover:bg-secondary hover:text-foreground",
              pathname.startsWith("/compare") && "text-primary bg-primary/5"
            )}
          >
            Сравнение
            {compareCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-white">
                {compareCount}
              </span>
            )}
          </Link>

          <div className="mx-2 h-4 w-px bg-border/60" />

          <Link
            href={authLink.href}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-bold text-foreground/70 transition-all hover:bg-secondary hover:text-foreground",
              pathname.startsWith(authLink.href) && "text-primary bg-primary/5"
            )}
          >
            {authLink.label}
          </Link>

          {topCategories.length ? (
            <div className="group relative">
              <button type="button" className="ml-2 flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] hover:shadow-primary/30">
                Каталог
              </button>
              <div className="invisible absolute right-0 top-12 z-50 min-w-80 translate-y-2 rounded-2xl border border-border bg-card p-4 opacity-0 shadow-2xl transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <p className="mb-2 px-3 text-[10px] font-[900] uppercase tracking-wider text-muted-foreground">Бренды</p>
                    {virtualBrandCategories.map((category) => (
                      <Link key={category.href} href={category.href} className="block rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground transition-all hover:bg-secondary hover:text-primary">
                        {category.label.replace('Бренд: ', '')}
                      </Link>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <p className="mb-2 px-3 text-[10px] font-[900] uppercase tracking-wider text-muted-foreground">Популярное</p>
                    {topCategories.map((category) => (
                      <Link key={category.id} href={`/category/${category.slug}`} className="block rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground transition-all hover:bg-secondary hover:text-primary">
                        {category.name}
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <Link href="/catalog" className="flex items-center justify-center rounded-xl bg-secondary/50 py-2 text-xs font-[900] text-primary transition-all hover:bg-primary hover:text-white">
                    Смотреть всё
                  </Link>
                </div>
              </div>
            </div>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <ThemeToggle />
          <Link href="/catalog" className="rounded-xl bg-secondary/50 p-2.5 hover:bg-secondary lg:hidden" aria-label="Открыть поиск">
            <Search className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

