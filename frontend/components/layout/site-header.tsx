"use client";

import {
  GitCompareArrows,
  Heart,
  Menu,
  RotateCcw,
  Search,
  Shield,
  Truck,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/common/theme-toggle";
import { Input } from "@/components/ui/input";
import { useAuthMe } from "@/features/auth/use-auth";
import { useBrands, useCategories } from "@/features/catalog/use-catalog-queries";
import { cn } from "@/lib/utils/cn";
import { useCompareStore } from "@/store/compare.store";

const staticLinks = [{ href: "/catalog", label: "Каталог" }];

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
  const compareCountFromStore = useCompareStore((state) => state.items.length);
  const [query, setQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
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
  const topBrands = useMemo(() => (hydrated ? (brands.data ?? []).slice(0, 5) : []), [brands.data, hydrated]);
  const compareCount = hydrated ? compareCountFromStore : 0;
  const isAuthenticated = hydrated && Boolean(me.data?.id);
  const isLoginPage = pathname === "/login";
  const authLink = isAuthenticated
    ? { href: "/profile", label: "Профиль" }
    : isLoginPage
      ? { href: "/register", label: "Регистрация" }
      : { href: "/login", label: "Войти" };

  const suggestions = useMemo(() => {
    const brandSuggestions = topBrands.map((brand) => brand.name);
    const categorySuggestions = topCategories.map((category) => category.name);
    return Array.from(new Set([...brandSuggestions, ...categorySuggestions])).slice(0, 7);
  }, [topBrands, topCategories]);

  const filteredSuggestions =
    query.trim().length > 0 ? suggestions.filter((item) => item.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 5) : [];

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = query.trim();
    router.push(next ? `/catalog?q=${encodeURIComponent(next)}` : "/catalog");
    setSearchFocused(false);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card">
      <div className="bg-card text-muted-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-2 text-sm">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" />
              Проверенные магазины
            </span>
            <span className="hidden items-center gap-1.5 sm:flex">
              <Shield className="h-3.5 w-3.5" />
              Актуализация цен
            </span>
            <span className="hidden items-center gap-1.5 md:flex">
              <RotateCcw className="h-3.5 w-3.5" />
              Сравнение в реальном времени
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
              <span className="font-heading text-lg font-bold text-accent-foreground">D</span>
            </div>
            <span className="hidden font-heading text-xl font-bold text-foreground lg:block">Doxx</span>
          </Link>

          <div className="relative hidden max-w-2xl flex-1 lg:block">
            <form className="relative" onSubmit={onSearchSubmit}>
              <div className={cn("flex items-center rounded-lg border bg-card transition-colors", searchFocused ? "border-accent" : "border-border")}>
                <Search className="pointer-events-none ml-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  placeholder="Поиск товаров, брендов, категорий..."
                  className="h-10 border-none bg-transparent pl-2 pr-20 shadow-none focus-visible:ring-0"
                  aria-label="Поиск товаров"
                />
                <button type="submit" className="absolute right-1.5 top-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground">
                  Найти
                </button>
              </div>
            </form>
            {searchFocused && filteredSuggestions.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-soft">
                {filteredSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setQuery(suggestion);
                      router.push(`/catalog?q=${encodeURIComponent(suggestion)}`);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                  >
                    <Search className="h-4 w-4 text-muted-foreground" />
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="ml-auto hidden items-center gap-1 md:flex">
            <Link href="/compare" className="flex flex-col items-center gap-0.5 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-accent">
              <GitCompareArrows className="h-5 w-5" />
              <span className="text-[10px]">Сравнение{compareCount ? ` (${compareCount})` : ""}</span>
            </Link>
            <Link href="/favorites" className="flex flex-col items-center gap-0.5 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-accent">
              <Heart className="h-5 w-5" />
              <span className="text-[10px]">Избранное</span>
            </Link>
            <Link href={authLink.href} className="flex flex-col items-center gap-0.5 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-accent">
              <User className="h-5 w-5" />
              <span className="text-[10px]">{authLink.label}</span>
            </Link>
            <ThemeToggle />
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-foreground md:hidden"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      <nav className="bg-card">
        <div className="mx-auto max-w-7xl px-4">
          <ul className="scrollbar-hide flex items-center gap-1 overflow-x-auto py-2">
            {staticLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary hover:text-accent",
                    pathname.startsWith(link.href) && "bg-secondary text-accent"
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {topBrands.map((brand) => (
              <li key={brand.id}>
                <Link
                  href={`/category/brand-${slugify(brand.name)}`}
                  className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary hover:text-accent"
                >
                  {brand.name}
                </Link>
              </li>
            ))}
            {topCategories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/category/${category.slug}`}
                  className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary hover:text-accent"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {mobileMenuOpen ? (
        <div className="bg-card md:hidden">
          <div className="mx-auto max-w-7xl space-y-3 px-4 py-4">
            <form className="relative" onSubmit={onSearchSubmit}>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск..." className="pl-9" />
            </form>
            <div className="grid gap-1">
              <Link href="/catalog" className="rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary">
                Каталог
              </Link>
              <Link href="/compare" className="rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary">
                Сравнение{compareCount ? ` (${compareCount})` : ""}
              </Link>
              <Link href="/favorites" className="rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary">
                Избранное
              </Link>
              <Link href={authLink.href} className="rounded-lg px-3 py-2 text-sm text-foreground hover:bg-secondary">
                {authLink.label}
              </Link>
            </div>
            {topCategories.length ? (
              <div className="pt-2">
                {topCategories.map((category) => (
                  <Link key={category.id} href={`/category/${category.slug}`} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
                    {category.name}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end">
              <ThemeToggle />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
