"use client";

import { Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useUiStore } from "@/store/ui.store";

export function AdminTopbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const toggleSidebar = useUiStore((s) => s.toggleDashboardSidebar);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleSidebar} className="hidden lg:inline-flex">
            <Menu className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}
