"use client";

import { Heart, Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/common/theme-toggle";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

const links = [
  { href: "/catalog", label: "Catalog" },
  { href: "/favorites", label: "Favorites" },
  { href: "/profile", label: "Profile" }
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <span>ZincMarket</span>
        </Link>

        <div className="relative hidden flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search products, brands..." />
        </div>

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
        </nav>

        <Link href="/favorites" className="rounded-xl p-2 hover:bg-secondary md:hidden">
          <Heart className="h-4 w-4" />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}

