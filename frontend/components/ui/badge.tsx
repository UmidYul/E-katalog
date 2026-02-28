import { cn } from "@/lib/utils/cn";

type BadgeVariant = "default" | "outline";

type BadgeProps = {
  className?: string;
  children: React.ReactNode;
  variant?: BadgeVariant;
};

const variantClasses: Record<BadgeVariant, string> = {
  default: "border-border/60 bg-secondary/80 text-secondary-foreground",
  outline: "border-border/60 bg-background/60 text-foreground",
};

export const Badge = ({ className, children, variant = "default" }: BadgeProps) => (
  <span className={cn("inline-flex items-center rounded-xl border px-2.5 py-1 text-xs font-semibold", variantClasses[variant], className)}>
    {children}
  </span>
);

