"use client";

import { motion } from "framer-motion";
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

import { cn } from "@/lib/utils/cn";

type TabsContextType = {
  value: string;
  setValue: (value: string) => void;
  layoutId: string;
};

const TabsContext = createContext<TabsContextType | null>(null);

let counter = 0;

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  className,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const layoutId = useMemo(() => `tabs-indicator-${++counter}`, []);
  const value = controlledValue ?? internalValue;
  const setValue = useCallback((v: string) => {
    setInternalValue(v);
    onValueChange?.(v);
  }, [onValueChange]);
  const context = useMemo(() => ({ value, setValue, layoutId }), [value, setValue, layoutId]);
  return (
    <TabsContext.Provider value={context}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-muted/60 p-1 gap-0.5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext);
  if (!ctx) return null;
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "relative rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-150",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {active && (
        <motion.span
          layoutId={ctx.layoutId}
          className="absolute inset-0 rounded-md bg-card shadow-sm"
          transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </button>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useContext(TabsContext);
  if (!ctx || ctx.value !== value) return null;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
