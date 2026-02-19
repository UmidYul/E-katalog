import { cn } from "@/lib/utils/cn";

export const Badge = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-xl bg-secondary px-2.5 py-1 text-xs font-medium", className)}>{children}</span>
);

