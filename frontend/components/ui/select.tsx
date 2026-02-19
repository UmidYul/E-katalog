"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { ReactNode } from "react";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ children }: { children: ReactNode }) {
  return (
    <SelectPrimitive.Trigger className="flex h-10 w-full items-center justify-between rounded-2xl border border-input px-3 text-sm">
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="h-4 w-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ children }: { children: ReactNode }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content className="z-50 mt-1 rounded-2xl border border-border bg-card p-1 shadow-soft">
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <SelectPrimitive.Item value={value} className="relative flex cursor-pointer select-none items-center rounded-xl px-3 py-2 text-sm outline-none hover:bg-secondary">
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-3">
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

