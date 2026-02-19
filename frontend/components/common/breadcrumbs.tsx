import Link from "next/link";

export function Breadcrumbs({ items }: { items: Array<{ href: string; label: string }> }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {items.map((item, idx) => (
        <span key={item.href + item.label} className="flex items-center gap-2">
          {idx > 0 ? <span>/</span> : null}
          <Link href={item.href} className="hover:text-foreground">
            {item.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}

