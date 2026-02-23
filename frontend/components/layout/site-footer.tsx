import Link from "next/link";

export function SiteFooter() {
  const currentYear = new Date().getUTCFullYear();

  return (
    <footer className="mt-20 border-t border-border/70 py-10">
      <div className="container flex flex-col gap-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>Copyright {currentYear} ZincMarket. Price intelligence for shoppers.</p>
        <div className="flex gap-4">
          <Link href="/catalog">Catalog</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/profile">Account</Link>
          <Link href="/robots.txt">Robots</Link>
        </div>
      </div>
    </footer>
  );
}
