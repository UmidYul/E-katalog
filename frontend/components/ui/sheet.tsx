"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { createContext, ReactNode, useContext, useEffect } from "react";

import { cn } from "@/lib/utils/cn";

const SheetContext = createContext<{ open: boolean } | null>(null);

export function Sheet(props: React.ComponentProps<typeof Dialog.Root> & { name?: string }) {
  const { name, open, onOpenChange, children, ...rest } = props;

  useEffect(() => {
    const onOther = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as string | undefined;
        if (!detail) return;
        if (detail !== name) {
          // if this sheet is open, close it when another sheet opens
          if (open && typeof onOpenChange === "function") onOpenChange(false);
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener("sheet-opened", onOther as EventListener);
    return () => window.removeEventListener("sheet-opened", onOther as EventListener);
  }, [name, open, onOpenChange]);

  // when this sheet opens, announce it
  useEffect(() => {
    if (open) {
      try {
        window.dispatchEvent(new CustomEvent("sheet-opened", { detail: name }));
      } catch {
        // ignore
      }
    }
  }, [name, open]);

  return (
    // pass through to Radix Dialog.Root with context
    <Dialog.Root open={open} onOpenChange={onOpenChange} {...rest}>
      <SheetContext.Provider value={{ open: !!open }}>
        {children}
      </SheetContext.Provider>
    </Dialog.Root>
  );
}

export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  children,
  className,
  side = "right",
  title = "Panel",
}: {
  children: ReactNode;
  className?: string;
  side?: "right" | "left" | "bottom";
  title?: string;
}) {
  const context = useContext(SheetContext);
  const open = context?.open ?? false;

  const variants = {
    right: {
      initial: { x: "100%" },
      animate: { x: 0 },
      exit: { x: "100%" },
      className: "right-0 top-0 h-full w-[86vw] max-w-sm border-l",
    },
    left: {
      initial: { x: "-100%" },
      animate: { x: 0 },
      exit: { x: "-100%" },
      className: "left-0 top-0 h-full w-[86vw] max-w-sm border-r",
    },
    bottom: {
      initial: { y: "100%" },
      animate: { y: 0 },
      exit: { y: "100%" },
      className: "bottom-0 left-0 right-0 max-h-[90vh] rounded-t-xl border-t",
    },
  };
  const v = variants[side];

  return (
    <Dialog.Portal forceMount>
      <AnimatePresence>
        {open && (
          <>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                className={cn(
                  "fixed z-50 border-border bg-card p-5 shadow-lg outline-none",
                  v.className,
                  className
                )}
                initial={v.initial}
                animate={v.animate}
                exit={v.exit}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
              >
                <Dialog.Title className="sr-only">{title}</Dialog.Title>
                <Dialog.Close className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </Dialog.Close>
                {children}
              </motion.div>
            </Dialog.Content>
          </>
        )}
      </AnimatePresence>
    </Dialog.Portal>
  );
}

