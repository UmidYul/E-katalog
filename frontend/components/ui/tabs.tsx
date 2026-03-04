"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";

import { cn } from "@/lib/utils/cn";

type TabsContextType = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = createContext<TabsContextType | null>(null);

export function Tabs({ defaultValue, children, className }: { defaultValue: string; children: ReactNode; className?: string }) {
  const [value, setValue] = useState(defaultValue);
  const context = useMemo(() => ({ value, setValue }), [value]);
  return (
    <TabsContext.Provider value={context}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("inline-flex rounded-2xl border border-border/70 bg-secondary/80 p-1", className)}>{children}</div>;
}

export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext);
  if (!ctx) return null;
  const active = ctx.value === value;
  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      className={cn(
        "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext);
  if (!ctx || ctx.value !== value) return null;
  return <div className={className}>{children}</div>;
}
