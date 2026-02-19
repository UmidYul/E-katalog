"use client";

import { ReactNode, useMemo } from "react";
import { usePathname } from "next/navigation";

import { AdminFooter } from "@/components/layout/admin-footer";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopbar } from "@/components/layout/admin-topbar";

const titles: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Overview", subtitle: "Marketplace operational snapshot" },
  "/dashboard/users": { title: "Users", subtitle: "Search, moderate and manage accounts" },
  "/dashboard/products": { title: "Products", subtitle: "Canonical products and store offers" },
  "/dashboard/categories": { title: "Categories", subtitle: "Catalog taxonomy and nesting" },
  "/dashboard/orders": { title: "Orders", subtitle: "Order flow and status management" },
  "/dashboard/analytics": { title: "Analytics", subtitle: "KPIs, trends and activity" },
  "/dashboard/settings": { title: "Settings", subtitle: "Platform-wide configuration" },
};

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const header = useMemo(() => {
    const found = Object.keys(titles).find((route) => pathname === route || pathname.startsWith(`${route}/`));
    return found ? titles[found] ?? { title: "Dashboard", subtitle: "Admin workspace" } : { title: "Dashboard", subtitle: "Admin workspace" };
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <AdminTopbar title={header.title} subtitle={header.subtitle} />
        <main className="flex-1 space-y-4 px-4 py-4 sm:px-6">{children}</main>
        <AdminFooter />
      </div>
    </div>
  );
}
