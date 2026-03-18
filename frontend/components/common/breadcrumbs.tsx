import Link from "next/link";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {items.map((item, idx) => (
        <span key={`${item.href ?? "current"}-${item.label}`} className="flex items-center gap-2">
          {idx > 0 ? <span>/</span> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export const Breadcrumb = Breadcrumbs;

