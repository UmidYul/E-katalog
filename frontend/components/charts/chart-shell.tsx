"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function ChartShell({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="mb-3 space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ChartEmptyState({ label = "Недостаточно данных" }: { label?: string }) {
  return (
    <div className="grid h-52 place-items-center rounded-xl border border-dashed border-border bg-secondary/40 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
