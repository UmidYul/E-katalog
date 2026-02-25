import { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("rounded-2xl border border-border/80 bg-card/95 text-card-foreground shadow-soft backdrop-blur-sm", className)}>{children}</div>
);

export const CardHeader = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("p-5", className)}>{children}</div>
);

export const CardContent = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("p-5 pt-0", className)}>{children}</div>
);

export const CardTitle = ({ children, className }: { children: ReactNode; className?: string }) => (
  <h3 className={cn("text-base font-semibold", className)}>{children}</h3>
);

