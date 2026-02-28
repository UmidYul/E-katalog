"use client";

import { Menu } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function SellerTopbar({
  title,
  subtitle,
  onToggleSidebar,
  userName,
}: {
  title: string;
  subtitle?: string;
  onToggleSidebar: () => void;
  userName: string;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="hidden lg:inline-flex">
            <Menu className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {subtitle ? <p className="text-xs text-slate-600">{subtitle}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 sm:inline-flex">
            {userName}
          </span>
          <Link href="/dashboard/admin" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            Admin
          </Link>
        </div>
      </div>
    </header>
  );
}
