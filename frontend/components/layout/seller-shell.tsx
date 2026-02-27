"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuthMe } from "@/features/auth/use-auth";
import { SellerSidebar } from "@/components/layout/seller-sidebar";
import { SellerTopbar } from "@/components/layout/seller-topbar";

const PLATFORM_STAFF_ROLES = new Set(["admin", "moderator", "seller_support"]);

const titles: Record<string, { title: string; subtitle: string }> = {
  "/seller": { title: "Seller Overview", subtitle: "Performance, health, billing, and support in one cockpit" },
  "/seller/onboarding": { title: "Onboarding", subtitle: "Legal profile, KYC docs, and contract acceptance" },
  "/seller/feeds": { title: "Feed Operations", subtitle: "Source setup, validation runs, and quality control" },
  "/seller/campaigns": { title: "Campaign Manager", subtitle: "Budget, bids, and placement strategy" },
  "/seller/billing": { title: "Billing", subtitle: "Plans, invoices, acts, and payment status" },
  "/seller/support": { title: "Support Center", subtitle: "Tickets, priority escalation, and response tracking" },
};

export function SellerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const role = useMemo(() => {
    const raw = String((me.data as { role?: string } | null | undefined)?.role ?? "");
    return raw.trim().toLowerCase().replace("-", "_");
  }, [me.data]);
  const blockedRole = PLATFORM_STAFF_ROLES.has(role);

  useEffect(() => {
    if (me.isLoading) return;
    if (!me.data) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/seller")}`);
      return;
    }
    if (blockedRole) {
      router.replace("/dashboard");
    }
  }, [blockedRole, me.data, me.isLoading, pathname, router]);

  const header = useMemo(() => {
    const matched = Object.keys(titles).find((route) => pathname === route || pathname.startsWith(`${route}/`));
    const fallback = { title: "Seller Panel", subtitle: "B2B workspace" };
    if (!matched) return fallback;
    return titles[matched] ?? fallback;
  }, [pathname]);

  if (me.isLoading || !me.data || blockedRole) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  const userName = String((me.data as { full_name?: string } | undefined)?.full_name ?? "").trim() || String(me.data.email || "seller");

  return (
    <div className="flex min-h-screen bg-slate-50">
      <SellerSidebar open={sidebarOpen} />
      <div className="flex min-h-screen flex-1 flex-col">
        <SellerTopbar title={header.title} subtitle={header.subtitle} onToggleSidebar={() => setSidebarOpen((value) => !value)} userName={userName} />
        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
