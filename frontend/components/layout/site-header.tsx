"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Heart,
  LayoutGrid,
  List,
  LogOut,
  MapPin,
  Menu,
  Search,
  Settings,
  Scale,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LocaleSwitcher } from "@/components/common/locale-switcher";
import { useLocale, useT } from "@/components/common/locale-provider";
import { ThemeToggle } from "@/components/common/theme-toggle";
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
import { useFavorites } from "@/features/user/use-favorites";
import type { CatalogCategory } from "@/lib/api/openapi-client";
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
    } catch {
      // no-op
    }
  }, []);

  const add = useCallback((term: string) => {
    setRecent((prev) => {
      const next = [term, ...prev.filter((t) => t !== term)].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // no-op
      }
      return next;
    });
  }, []);

  return { recent, add };
}

const getCategoryLabel = (category: CatalogCategory, locale: "ru-RU" | "uz-Cyrl-UZ") => {
  if (locale === "uz-Cyrl-UZ") return category.name_uz?.trim() || category.name?.trim() || category.slug;
  return category.name_ru?.trim() || category.name?.trim() || category.name_uz?.trim() || category.slug;
};

export function SiteHeader() {
  const t = useT("header");
  const { locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const shouldLoadMe = pathname !== "/login" && pathname !== "/register";
  const me = useAuthMe(shouldLoadMe);
  const logout = useLogout();

  const categories = useCategories();
  const favorites = useFavorites();

  const compareCount = useCompareStore((state) => state.items.length);
  const { recent, add: addRecent } = useRecentSearches();

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [debounced, setDebounced] = useState("");
  const [activeRootCategoryId, setActiveRootCategoryId] = useState<string | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const searchRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
  }, [pathname]);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timeoutId);
  }, [query]);

  const allCategories = useMemo(() => (hydrated ? (categories.data ?? []) : []), [categories.data, hydrated]);

  const rootCategories = useMemo(() => allCategories.filter((item) => !item.parent_id).slice(0, 12), [allCategories]);

  const childCategoryMap = useMemo(() => {
    const map = new Map<string, CatalogCategory[]>();
    allCategories.forEach((category) => {
      if (!category.parent_id) return;
      const list = map.get(category.parent_id) ?? [];
      list.push(category);
      map.set(category.parent_id, list);
    });
    map.forEach((list) => list.sort((a, b) => getCategoryLabel(a, locale).localeCompare(getCategoryLabel(b, locale))));
    return map;
  }, [allCategories, locale]);

  useEffect(() => {
    if (!rootCategories.length) {
      setActiveRootCategoryId(null);
      return;
    }
    if (!activeRootCategoryId || !rootCategories.some((item) => item.id === activeRootCategoryId)) {
      setActiveRootCategoryId(rootCategories[0]?.id ?? null);
    }
  }, [activeRootCategoryId, rootCategories]);

  const activeRootCategory = useMemo(
    () => rootCategories.find((item) => item.id === activeRootCategoryId) ?? rootCategories[0] ?? null,
    [activeRootCategoryId, rootCategories]
  );

  const activeChildCategories = useMemo(
    () => (activeRootCategory ? childCategoryMap.get(activeRootCategory.id) ?? [] : []),
    [activeRootCategory, childCategoryMap]
  );

  const categoryBrands = useBrands({
    categoryId: activeRootCategory?.id,
    limit: 16,
    enabled: Boolean(activeRootCategory?.id),
  });

  const topBrands = useMemo(() => (categoryBrands.data ?? []).slice(0, 8), [categoryBrands.data]);

  useEffect(() => {
    if (!catalogOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCatalogOpen(false);
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (catalogRef.current && !catalogRef.current.contains(event.target as Node)) {
        setCatalogOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [catalogOpen]);

  const suggestions = useMemo(() => {
    if (!debounced.trim()) return [];
    const term = debounced.toLowerCase();

    const catMatches = rootCategories
      .filter((category) => getCategoryLabel(category, locale).toLowerCase().includes(term))
      .map((category) => ({ type: "category" as const, label: getCategoryLabel(category, locale), href: `/category/${category.slug}` }));

    const brandMatches = topBrands
      .filter((brand) => brand.name.toLowerCase().includes(term))
      .map((brand) => ({ type: "brand" as const, label: brand.name, href: `/catalog?q=${encodeURIComponent(brand.name)}` }));

    return [...brandMatches, ...catMatches].slice(0, 8);
  }, [debounced, locale, rootCategories, topBrands]);

  const onSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (term) addRecent(term);
    router.push(term ? `/catalog?q=${encodeURIComponent(term)}` : "/catalog");
    setSearchOpen(false);
    setHighlightIdx(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!searchOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIdx((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIdx((index) => Math.max(index - 1, -1));
      return;
    }
    if (event.key === "Escape") {
      setSearchOpen(false);
      setHighlightIdx(-1);
      return;
    }
    if (event.key === "Enter" && highlightIdx >= 0) {
      event.preventDefault();
      const item = suggestions[highlightIdx];
      if (item) {
        router.push(item.href);
        setSearchOpen(false);
      }
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!searchDropdownRef.current?.contains(document.activeElement)) {
        setSearchOpen(false);
        setHighlightIdx(-1);
      }
    }, 150);
  };

  const showDropdown = searchOpen && (suggestions.length > 0 || (!query.trim() && recent.length > 0));

  const compareCountSafe = hydrated ? compareCount : 0;
  const favoriteCountSafe = hydrated ? (favorites.data?.length ?? 0) : 0;
  const compareLabel = locale === "uz-Cyrl-UZ" ? "Солиштириш" : "Сравнение";
  const favoritesLabel = locale === "uz-Cyrl-UZ" ? "Сараланганлар" : "Избранное";
  const isAuthenticated = hydrated && Boolean(me.data?.id);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-white">
      <div className="hidden bg-[#2b2b2f] text-white md:block">
        <div className="mx-auto flex h-10 max-w-[1280px] items-center justify-between px-4 text-sm">
          <div className="flex items-center gap-5">
            <span className="inline-flex items-center gap-1.5 text-white/90">
              <MapPin className="h-4 w-4" />
              {t("city")}
            </span>
            <Link href="/contacts" className="text-white/90 transition-colors hover:text-white">{t("ourStores")}</Link>
            <Link href="/become-seller" className="rounded-md bg-white/15 px-2 py-0.5 text-white">{t("forBusiness")}</Link>
            <Link href="/terms" className="text-white/90 transition-colors hover:text-white">{t("paymentMethods")}</Link>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-white/80">{t("contactCenter")}: <span className="font-semibold text-white">+99871 209 99 44</span></span>
            <div className="rounded-full border border-white/30 px-2 py-0.5 text-xs">{t("currencyCode")}</div>
            <LocaleSwitcher />
          </div>
        </div>
      </div>

      <div ref={catalogRef} className="relative">
        <div className="mx-auto max-w-[1280px] px-4 py-2">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="shrink-0 leading-none" aria-label={t("homeAria")}>
              <span className="font-heading text-[44px] font-black leading-none tracking-tight text-foreground">
                Doxx
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setCatalogOpen((prev) => !prev)}
              aria-expanded={catalogOpen}
              aria-controls="catalog-mega-menu"
              className={cn(
                "hidden h-10 items-center gap-2 rounded-xl border border-primary bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors md:inline-flex",
                catalogOpen ? "bg-primary/90" : "hover:bg-primary/90"
              )}
            >
              <List className="h-4 w-4" />
              {t("navCatalog")}
            </button>

            <div className="relative hidden flex-1 md:block" ref={searchDropdownRef}>
              <form onSubmit={onSearchSubmit}>
                <div className="flex h-10 items-center overflow-hidden rounded-xl border border-border bg-white focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSearchOpen(true);
                      setHighlightIdx(-1);
                    }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={handleBlur}
                    onKeyDown={onKeyDown}
                    placeholder={t("searchPlaceholder")}
                    className="h-full flex-1 bg-transparent px-4 text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
                    aria-label={t("searchAria")}
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <button type="submit" className="flex h-full w-14 items-center justify-center bg-primary text-primary-foreground transition-colors hover:bg-primary/90">
                    <Search className="h-5 w-5" />
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
                    className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-white shadow-xl"
                  >
                    {!query.trim() && recent.length > 0 && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground">{t("recentSearches")}</div>
                        {recent.map((term, index) => (
                          <button
                            key={term}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setQuery(term);
                              addRecent(term);
                              router.push(`/catalog?q=${encodeURIComponent(term)}`);
                              setSearchOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-muted",
                              highlightIdx === index && "bg-muted"
                            )}
                          >
                            <Search className="h-4 w-4 text-muted-foreground" />
                            <span>{term}</span>
                          </button>
                        ))}
                      </>
                    )}

                    {suggestions.length > 0 && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-muted-foreground">{t("results")}</div>
                        {suggestions.map((item, index) => (
                          <button
                            key={item.href}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              if (item.type !== "category") addRecent(item.label);
                              router.push(item.href);
                              setSearchOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-muted",
                              highlightIdx === index && "bg-muted"
                            )}
                          >
                            <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">
                              {item.type === "brand" ? t("badgeBrand") : t("badgeCategory")}
                            </span>
                            <span>{item.label}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="ml-auto hidden items-center gap-6 md:flex">
              <Link href={isAuthenticated ? "/profile" : "/login"} className="flex min-w-[72px] flex-col items-center text-foreground/90 hover:text-foreground">
                <User className="h-6 w-6" />
                <span className="mt-1 text-xs font-medium">{isAuthenticated ? t("navProfile") : t("login")}</span>
              </Link>

              <Link href="/favorites" className="relative flex min-w-[72px] flex-col items-center text-foreground/90 hover:text-foreground">
                <Heart className="h-6 w-6" />
                {favoriteCountSafe > 0 ? (
                  <span className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                    {favoriteCountSafe}
                  </span>
                ) : null}
                <span className="mt-1 text-xs font-medium">{favoritesLabel}</span>
              </Link>

              <Link href="/compare" className="relative flex min-w-[72px] flex-col items-center text-foreground/90 hover:text-foreground">
                <Scale className="h-6 w-6" />
                {compareCountSafe > 0 ? (
                  <span className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                    {compareCountSafe}
                  </span>
                ) : null}
                <span className="mt-1 text-xs font-medium">{compareLabel}</span>
              </Link>
            </div>

            <div className="ml-auto flex items-center gap-1 md:hidden">
              <Link href="/catalog" className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
                <List className="h-4 w-4" />
                {t("navCatalog")}
              </Link>
              <Link href="/favorites" className="relative rounded-lg p-2 text-foreground/80 hover:bg-muted">
                <Heart className="h-5 w-5" />
                {favoriteCountSafe > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                    {favoriteCountSafe}
                  </span>
                ) : null}
              </Link>
              <Link href="/compare" className="relative rounded-lg p-2 text-foreground/80 hover:bg-muted">
                <Scale className="h-5 w-5" />
                {compareCountSafe > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                    {compareCountSafe}
                  </span>
                ) : null}
              </Link>
              <Sheet name="menu" open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <button type="button" className="rounded-lg p-2 text-foreground hover:bg-muted" aria-label={t("openMenu")}>
                    <Menu className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="flex flex-col gap-4 p-0 pt-14">
                  <div className="px-4">
                    <form onSubmit={onSearchSubmit} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t("mobileSearchPlaceholder")}
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </form>
                  </div>

                  <nav className="flex flex-col gap-0.5 px-3">
                    {[{ href: "/", label: t("navHome") }, { href: "/catalog", label: t("allProducts") }, { href: "/compare", label: compareLabel }, { href: "/favorites", label: favoritesLabel }].map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={cn(
                          "rounded-md px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted",
                          pathname === link.href ? "bg-muted text-accent" : "text-foreground"
                        )}
                      >
                        {link.label}
                      </Link>
                    ))}
                    {!isAuthenticated ? (
                      <Link href="/login" className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                        {t("login")}
                      </Link>
                    ) : (
                      <>
                        <Link href="/profile" className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                          {t("navProfile")}
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="rounded-md px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-muted">{t("accountAria")}</button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-56">
                            <DropdownMenuLabel>{me.data?.email ?? t("accountFallback")}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {me.data?.role === "admin" ? (
                              <DropdownMenuItem asChild>
                                <Link href="/dashboard/admin"><Settings className="mr-2 h-4 w-4" /> {t("adminDashboard")}</Link>
                              </DropdownMenuItem>
                            ) : null}
                            {me.data?.role === "seller" ? (
                              <DropdownMenuItem asChild>
                                <Link href="/dashboard/seller"><LayoutGrid className="mr-2 h-4 w-4" /> {t("sellerCabinet")}</Link>
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem onClick={() => logout?.mutate(undefined)} className="text-danger focus:bg-danger/10 focus:text-danger">
                              <LogOut className="mr-2 h-4 w-4" /> {t("logout")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </nav>

                  <div className="px-3">
                    <button
                      type="button"
                      onClick={() => setMobileCatalogOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2.5 text-left text-sm font-semibold text-foreground"
                    >
                      <span>{t("navCatalog")}</span>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", mobileCatalogOpen && "rotate-180")} />
                    </button>

                    {mobileCatalogOpen && (
                      <div className="mt-2 space-y-3 rounded-lg border border-border bg-muted/20 p-2">
                        <div className="space-y-1">
                          {rootCategories.map((category) => (
                            <button
                              key={category.id}
                              type="button"
                              onClick={() => setActiveRootCategoryId(category.id)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                                activeRootCategory?.id === category.id ? "bg-accent/10 font-semibold text-accent" : "text-foreground hover:bg-muted"
                              )}
                            >
                              <span>{getCategoryLabel(category, locale)}</span>
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          ))}
                        </div>

                        {activeRootCategory ? (
                          <div className="rounded-md border border-border bg-white p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("subcategoriesTitle")}</p>
                            <div className="mt-2 grid gap-1">
                              {(activeChildCategories.length ? activeChildCategories : [activeRootCategory]).map((category) => (
                                <Link
                                  key={category.id}
                                  href={`/category/${category.slug}`}
                                  onClick={() => setMenuOpen(false)}
                                  className="rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
                                >
                                  {getCategoryLabel(category, locale)}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="mt-auto space-y-3 border-t border-border px-4 py-4">
                    <LocaleSwitcher />
                    <ThemeToggle />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {catalogOpen && (
            <motion.div
              id="catalog-mega-menu"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 right-0 top-full z-50 hidden border-t border-border bg-white shadow-xl md:block"
            >
              <div className="mx-auto grid max-w-[1280px] grid-cols-[300px_1fr] px-4 py-4">
                <aside className="max-h-[520px] overflow-y-auto border-r border-border pr-3">
                  <div className="space-y-1">
                    {rootCategories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveRootCategoryId(category.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                          activeRootCategory?.id === category.id ? "bg-[#fff6cc] font-semibold text-black" : "text-foreground hover:bg-muted"
                        )}
                      >
                        <span>{getCategoryLabel(category, locale)}</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </aside>

                <section className="pl-6">
                  {activeRootCategory ? (
                    <>
                      <h3 className="text-3xl font-bold text-foreground">{getCategoryLabel(activeRootCategory, locale)}</h3>
                      <div className="mt-6 grid grid-cols-3 gap-8">
                        <div>
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("subcategoriesTitle")}</p>
                          <div className="space-y-1">
                            {(activeChildCategories.length ? activeChildCategories : [activeRootCategory]).map((category) => (
                              <Link
                                key={category.id}
                                href={`/category/${category.slug}`}
                                onClick={() => setCatalogOpen(false)}
                                className="block rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
                              >
                                {getCategoryLabel(category, locale)}
                              </Link>
                            ))}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("brandsTitle")}</p>
                          <div className="grid grid-cols-2 gap-1 lg:grid-cols-3">
                            {(categoryBrands.data ?? []).slice(0, 15).map((brand) => (
                              <Link
                                key={brand.id}
                                href={`/catalog/${encodeURIComponent(activeRootCategory.slug)}?q=${encodeURIComponent(brand.name)}`}
                                onClick={() => setCatalogOpen(false)}
                                className="rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
                              >
                                {brand.name}
                              </Link>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("categories")}</p>
                  )}
                </section>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
