"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
    return (
        <SonnerToaster
            position="bottom-right"
            toastOptions={{
                classNames: {
                    toast:
                        "group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg text-sm text-foreground",
                    title: "font-semibold",
                    description: "text-muted-foreground text-xs",
                    actionButton: "rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground",
                    cancelButton: "rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground",
                    closeButton:
                        "absolute right-2 top-2 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    success: "border-success/30",
                    error: "border-danger/30",
                    warning: "border-warning/30",
                    info: "border-accent/30",
                },
                duration: 4000,
            }}
            gap={8}
        />
    );
}
