"use client";

import { AnimatePresence, motion } from "framer-motion";
import { GitCompareArrows, Heart, LayoutGrid, LogOut, Menu, Search, Settings, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ThemeToggle } from "@/components/common/theme-toggle";
import { LocaleSwitcher } from "@/components/common/locale-switcher";
import { useT } from "@/components/common/locale-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuthMe, useLogout } from "@/features/auth/use-auth";
import { useBrands, useCategories } from "@/features/catalog/use-catalog-queries";
import { cn } from "@/lib/utils/cn";
import { useCompareStore } from "@/store/compare.store";

const RECENT_SEARCHES_KEY = "doxx_recent_searches";
const MAX_RECENT = 5;

function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) setRecent(JSON.parse(saved) as string[]);
    } catch { }
  }, []);
  const add = useCallback((term: string) => {
    setRecent((prev) => {
      const next = [term, ...prev.filter((t) => t !== term)].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch { }
      return next;
    });
  }, []);
  return { recent, add };
}

export function SiteHeader() {
  const t = useT("header");
  const router = useRouter();
  const pathname = usePathname();
  const shouldLoadMe = pathname !== "/login" && pathname !== "/register";
  const me = useAuthMe(shouldLoadMe);
  const logout = useLogout();
  const categories = useCategories();
  const brands = useBrands();
  const compareCount = useCompareStore((s) => s.items.length);
  const { recent, add: addRecent } = useRecentSearches();

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [debounced, setDebounced] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
  }, [pathname]);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const topCategories = useMemo(() => (hydrated ? (categories.data ?? []).slice(0, 8) : []), [categories.data, hydrated]);
  const topBrands = useMemo(() => (hydrated ? (brands.data ?? []).slice(0, 5) : []), [brands.data, hydrated]);
  const compareCountSafe = hydrated ? compareCount : 0;
  const compareCountSuffix = compareCountSafe ? ` (${compareCountSafe})` : "";
  const isAuthenticated = hydrated && Boolean(me.data?.id);
  const isLoginPage = pathname === "/login";

  const suggestions = useMemo(() => {
    if (!debounced.trim()) return [];
    const term = debounced.toLowerCase();
    const brandMatches = topBrands
      .filter((b) => b.name.toLowerCase().includes(term))
      .map((b) => ({ type: "brand" as const, label: b.name, href: `/catalog?q=${encodeURIComponent(b.name)}` }));
    const catMatches = topCategories
      .filter((c) => c.name.toLowerCase().includes(term))
      .map((c) => ({ type: "category" as const, label: c.name, href: `/category/${c.slug}` }));
    return [...brandMatches, ...catMatches].slice(0, 7);
  }, [debounced, topBrands, topCategories]);

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const term = query.trim();
    if (term) addRecent(term);
    router.push(term ? `/catalog?q=${encodeURIComponent(term)}` : "/catalog");
    setSearchOpen(false);
    setHighlightIdx(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!searchOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, -1)); }
    else if (e.key === "Escape") { setSearchOpen(false); setHighlightIdx(-1); }
    else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      const item = suggestions[highlightIdx];
      if (item) { router.push(item.href); setSearchOpen(false); }
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!dropdownRef.current?.contains(document.activeElement)) {
        setSearchOpen(false);
        setHighlightIdx(-1);
      }
    }, 150);
  };

  const showDropdown = searchOpen && (suggestions.length > 0 || (!query.trim() && recent.length > 0));

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled ? "bg-white/80 backdrop-blur-md shadow-sm border-b border-border/60" : "bg-white border-b border-border"
      )}
    >
      <div className="mx-auto flex max-w-[1280px] items-center gap-4 px-4 py-3">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label={t("homeAria")}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent shadow-sm">
            <span className="font-heading text-lg font-bold text-white">D</span>
          </div>
          <span className="font-heading text-lg font-bold text-foreground sm:text-xl">Doxx</span>
        </Link>

        {/* Search — center */}
        <div className="relative hidden flex-1 max-w-2xl md:block" ref={dropdownRef}>
          <form onSubmit={onSearchSubmit}>
            <div
              className={cn(
                "flex items-center rounded-md border bg-white transition-all duration-200",
                searchOpen ? "border-accent ring-2 ring-accent/20 shadow-sm" : "border-border hover:border-accent/50"
              )}
            >
              <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setHighlightIdx(-1); }}
                onFocus={() => setSearchOpen(true)}
                onBlur={handleBlur}
                onKeyDown={onKeyDown}
                placeholder={t("searchPlaceholder")}
                className="flex-1 bg-transparent py-2.5 pl-2 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                aria-label={t("searchAria")}
                aria-autocomplete="list"
                aria-expanded={showDropdown}
              />
              {query && (
                <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} className="mr-1 rounded p-1 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button type="submit" className="mr-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90">
                {t("searchButton")}
              </button>
            </div>
          </form>

          <AnimatePresence>
            {showDropdown && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-border bg-white shadow-lg"
              >
                {!query.trim() && recent.length > 0 && (
                  <>
                    <div className="px-4 py-2 text-xs font-semibold text-muted-foreground">{t("recentSearches")}</div>
                    {recent.map((term, i) => (
                      <button key={term} type="button"
                        onMouseDown={(e) => { e.preventDefault(); setQuery(term); addRecent(term); router.push(`/catalog?q=${encodeURIComponent(term)}`); setSearchOpen(false); }}
                        className={cn("flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted", highlightIdx === i && "bg-muted")}
                      >
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{term}</span>
                      </button>
                    ))}
                  </>
                )}
                {suggestions.length > 0 && (
                  <>
                    <div className="px-4 py-2 text-xs font-semibold text-muted-foreground">{t("results")}</div>
                    {suggestions.map((item, i) => (
                      <button key={item.href} type="button"
                        onMouseDown={(e) => { e.preventDefault(); if (item.type !== "category") addRecent(item.label); router.push(item.href); setSearchOpen(false); }}
                        className={cn("flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted", highlightIdx === i && "bg-muted")}
                      >
                        <span className={cn("rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", item.type === "brand" ? "bg-accent/10 text-accent" : "bg-success/10 text-success")}>
                          {item.type === "brand" ? t("badgeBrand") : t("badgeCategory")}
                        </span>
                        <span className="text-foreground">{item.label}</span>
                      </button>
                    ))}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/compare"
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("compareAria", { countSuffix: compareCountSuffix })}
          >
            <GitCompareArrows className="h-5 w-5" />
            {compareCountSafe > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                {compareCountSafe}
              </span>
            )}
          </Link>

          <Link
            href="/favorites"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("favoritesAria")}
          >
            <Heart className="h-5 w-5" />
          </Link>

          {hydrated && isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-muted" aria-label={t("accountAria")}>
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <User className="h-4 w-4" />
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <p className="text-xs font-normal text-muted-foreground truncate">{me.data?.email ?? t("accountFallback")}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="flex items-center gap-2"><User className="h-4 w-4" /> {t("profile")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/favorites" className="flex items-center gap-2"><Heart className="h-4 w-4" /> {t("favorites")}</Link>
                </DropdownMenuItem>
                {me.data?.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/admin" className="flex items-center gap-2"><Settings className="h-4 w-4" /> {t("adminDashboard")}</Link>
                  </DropdownMenuItem>
                )}
                {me.data?.role === "seller" && (
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/seller" className="flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> {t("sellerCabinet")}</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout?.mutate(undefined)}
                  className="text-danger focus:bg-danger/10 focus:text-danger"
                >
                  <LogOut className="mr-2 h-4 w-4" /> {t("logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              href={isLoginPage ? "/register" : "/login"}
              className="hidden rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-white md:inline-flex"
            >
              {isLoginPage ? t("register") : t("login")}
            </Link>
          )}

          <div className="hidden md:block">
            <LocaleSwitcher />
          </div>

          <div className="hidden md:block"><ThemeToggle /></div>

          {/* Mobile menu */}
          <Sheet name="menu" open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted md:hidden" aria-label={t("openMenu")}>
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col gap-4 p-0 pt-14">
              <div className="px-4">
                <form onSubmit={onSearchSubmit} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("mobileSearchPlaceholder")}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </form>
              </div>
              <nav className="flex flex-col gap-0.5 px-3">
                {[
                  { href: "/", label: t("navHome") },
                  { href: "/catalog", label: t("navCatalog") },
                  { href: "/compare", label: t("navCompare", { countSuffix: compareCountSuffix }) },
                  { href: "/favorites", label: t("favorites") },
                  isAuthenticated ? { href: "/profile", label: t("navProfile") } : { href: "/login", label: t("login") },
                ].map((link) => (
                  <Link key={link.href} href={link.href}
                    className={cn("rounded-md px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted", pathname === link.href ? "bg-muted text-accent" : "text-foreground")}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
              {topCategories.length > 0 && (
                <div className="px-3">
                  <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("categories")}</p>
                  {topCategories.map((cat) => (
                    <Link key={cat.id} href={`/category/${cat.slug}`}
                      className="block rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {cat.name}
                    </Link>
                  ))}
                </div>
              )}
              <div className="mt-auto border-t border-border px-4 py-4 space-y-3">
                <LocaleSwitcher />
                <ThemeToggle />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Nav strip */}
      <div className="hidden border-t border-border/50 md:block">
        <div className="mx-auto max-w-[1280px] px-4">
          <div className="scrollbar-hide flex items-center gap-0.5 overflow-x-auto py-1.5">
            <Link
              href="/catalog"
              className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted", pathname.startsWith("/catalog") ? "text-accent" : "text-muted-foreground")}
            >
              {t("allProducts")}
            </Link>
            {topBrands.map((brand) => (
              <Link key={brand.id} href={`/catalog?q=${encodeURIComponent(brand.name)}`}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {brand.name}
              </Link>
            ))}
            {topCategories.map((cat) => (
              <Link key={cat.id} href={`/category/${cat.slug}`}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {cat.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
