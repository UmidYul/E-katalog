import { cn } from "@/lib/utils/cn";

export const Badge = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-xl border border-border/60 bg-secondary/80 px-2.5 py-1 text-xs font-semibold text-secondary-foreground", className)}>
    {children}
  </span>
);

