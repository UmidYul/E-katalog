import { cn } from "@/lib/utils/cn";

export const Badge = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-sm border border-border/60 bg-secondary/80 px-2 py-0.5 text-xs font-semibold text-secondary-foreground", className)}>
    {children}
  </span>
);

