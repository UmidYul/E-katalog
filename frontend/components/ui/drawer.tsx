"use client";

import { ReactNode } from "react";

import { Sheet, SheetContent } from "@/components/ui/sheet";

export function Drawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>{children}</SheetContent>
    </Sheet>
  );
}
