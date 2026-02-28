"use client";

import { GitCompareArrows, Heart, Menu, Search, ShieldCheck, ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/common/theme-toggle";
import { Input } from "@/components/ui/input";
import { useAuthMe } from "@/features/auth/use-auth";
import { useBrands, useCategories } from "@/features/catalog/use-catalog-queries";
import { useFavorites } from "@/features/user/use-favorites";
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
  const favorites = useFavorites();
  const categories = useCategories();
  const brands = useBrands();
  const compareCountFromStore = useCompareStore((s) => s.items.length);
  const [query, setQuery] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleScroll = () => {
      const current = window.scrollY;
      const last = lastScrollYRef.current;

      if (current > last && current > 80) {
        setIsHidden(true);
      } else {
        setIsHidden(false);
      }

      lastScrollYRef.current = current;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
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
  const favoritesCount = hydrated ? favorites.data?.length ?? 0 : 0;
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
    setIsMobileSearchOpen(false);
    setIsMobileMenuOpen(false);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border bg-background/80 shadow-[0_18px_60px_-40px_hsl(var(--primary)/0.7)]",
        "supports-[backdrop-filter]:bg-background/75 supports-[backdrop-filter]:backdrop-blur-md",
        "transition-transform duration-300",
        isHidden && "-translate-y-full"
      )}
    >
      <div className="container flex h-14 items-center gap-3 md:h-16">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full px-2 py-1 font-heading text-lg font-bold tracking-tight"
          aria-label="На главную e-katalog"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShoppingBag className="h-4 w-4" />
          </span>
          <span className="text-gradient">e-katalog</span>
        </Link>

        <form className="relative hidden flex-1 lg:flex lg:justify-center" onSubmit={onSearchSubmit}>
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 rounded-full border-border/70 bg-surface-raised/70 pl-9 pr-28 text-sm shadow-sm ring-0 transition focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40"
              placeholder="Поиск по товарам, брендам, категориям..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              type="submit"
              className="gradient-primary absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-primary-foreground shadow-sm"
            >
              <Search className="h-3.5 w-3.5" />
              Найти
            </button>
          </div>
        </form>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground",
                pathname.startsWith(link.href) && "bg-secondary text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/compare"
            className={cn(
              "rounded-xl px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground",
              pathname.startsWith("/compare") && "bg-secondary text-foreground"
            )}
          >
            Сравнение{compareCount ? ` (${compareCount})` : ""}
          </Link>
          <Link
            href={authLink.href}
            className={cn(
              "rounded-xl px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground",
              pathname.startsWith(authLink.href) && "bg-secondary text-foreground"
            )}
          >
            {authLink.label}
          </Link>

          {topCategories.length ? (
            <div className="group relative">
              <button type="button" className="cursor-default rounded-xl px-3 py-2 text-sm font-medium text-foreground/80 transition-colors group-hover:bg-secondary group-hover:text-foreground">
                Категории
              </button>
              <div className="invisible absolute right-0 top-11 z-50 min-w-64 rounded-xl border border-border bg-card p-2 opacity-0 shadow-soft transition-all duration-150 group-hover:visible group-hover:opacity-100">
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
                <Link href="/catalog" className="mt-1 block rounded-lg px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-secondary">
                  Смотреть все категории
                </Link>
              </div>
            </div>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-1 md:ml-0 md:gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-secondary lg:hidden"
            aria-label="Открыть поиск по каталогу"
            onClick={() => setIsMobileSearchOpen(true)}
          >
            <Search className="h-4 w-4" />
          </button>
          <Link
            href="/favorites"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-secondary"
            aria-label="Открыть избранное"
          >
            <Heart className="h-4 w-4" />
            {favoritesCount ? (
              <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
                {favoritesCount > 9 ? "9+" : favoritesCount}
              </span>
            ) : null}
          </Link>
          <Link
            href="/compare"
            className="relative hidden h-9 items-center gap-1 rounded-full border border-border/60 px-3 text-xs font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary-subtle/60 hover:text-foreground md:inline-flex"
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            <span>Сравнение</span>
            {compareCount ? (
              <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                {compareCount}
              </span>
            ) : null}
          </Link>
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-surface/60 text-foreground transition-colors hover:border-primary/40 hover:bg-primary-subtle md:hidden"
            aria-label="Открыть меню"
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </button>
          <Link
            href={authLink.href}
            className={cn(
              "hidden items-center gap-2 rounded-full border border-border/70 bg-surface/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary-subtle md:inline-flex",
              pathname.startsWith(authLink.href) && "border-primary/60 bg-primary-subtle/80"
            )}
          >
            <span>{authLink.label}</span>
          </Link>
        </div>
      </div>

      <div className="hidden border-t border-border/70 bg-background/90 supports-[backdrop-filter]:bg-background/85 md:block dark:bg-card/90 dark:supports-[backdrop-filter]:bg-card/85">
        <div className="container flex h-9 items-center justify-between gap-3 text-xs text-foreground/75">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Проверенные магазины и прозрачные предложения
          </span>
          <span className="truncate">Цены обновляются регулярно. Сравнивайте офферы перед покупкой.</span>
        </div>
      </div>

      {isMobileSearchOpen ? (
        <div className="fixed inset-x-0 top-0 z-50 flex h-16 items-center border-b border-border bg-background/95 px-4 shadow-lg lg:hidden">
          <form className="relative flex w-full items-center gap-2" onSubmit={onSearchSubmit}>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-secondary"
              aria-label="Закрыть поиск"
              onClick={() => setIsMobileSearchOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 w-full rounded-full border-border/70 bg-surface-raised/80 pl-9 pr-24 text-sm shadow-sm ring-0 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40"
                autoFocus
                placeholder="Поиск по каталогу..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="submit"
                className="gradient-primary absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium text-primary-foreground shadow-sm"
              >
                Найти
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isMobileMenuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            aria-hidden="true"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="glass absolute inset-y-0 right-0 flex w-80 max-w-full flex-col border-l border-border bg-background/95 p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-heading text-base font-semibold">Меню</span>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-secondary"
                aria-label="Закрыть меню"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="space-y-1 text-sm">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2 text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground",
                    pathname.startsWith(link.href) && "bg-secondary text-foreground"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <span>{link.label}</span>
                </Link>
              ))}
              <Link
                href="/compare"
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground",
                  pathname.startsWith("/compare") && "bg-secondary text-foreground"
                )}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <span>Сравнение</span>
                {compareCount ? (
                  <span className="rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                    {compareCount}
                  </span>
                ) : null}
              </Link>
              <Link
                href={authLink.href}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground",
                  pathname.startsWith(authLink.href) && "bg-secondary text-foreground"
                )}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <span>{authLink.label}</span>
              </Link>
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  );
}

