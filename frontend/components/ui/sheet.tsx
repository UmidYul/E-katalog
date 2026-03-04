"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px]" />
      <Dialog.Content
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-[86vw] max-w-sm border-l border-border bg-card p-5 shadow-soft outline-none",
          className
        )}
      >
        <Dialog.Close className="absolute right-3 top-3 rounded-lg p-2 hover:bg-secondary">
          <X className="h-4 w-4" />
        </Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

