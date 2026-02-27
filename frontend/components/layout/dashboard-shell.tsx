"use client";

import { ReactNode, useMemo } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AdminFooter } from "@/components/layout/admin-footer";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopbar } from "@/components/layout/admin-topbar";
import { useAdminAccess } from "@/features/auth/use-admin-access";

const titles: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Executive Hub", subtitle: "Platform KPIs, risks, and operational priorities" },
  "/dashboard/users": { title: "Users", subtitle: "Accounts, roles, and activity" },
  "/dashboard/products": { title: "Products", subtitle: "Canonical products and merchant offers" },
  "/dashboard/categories": { title: "Categories", subtitle: "Taxonomy and catalog structure" },
  "/dashboard/orders": { title: "Orders", subtitle: "Order flow and status control" },
  "/dashboard/feedback": { title: "Moderation", subtitle: "Reviews and questions queue" },
  "/dashboard/analytics": { title: "Analytics 360", subtitle: "Revenue, quality, operations, moderation, users" },
  "/dashboard/b2b": { title: "B2B Control", subtitle: "Onboarding, disputes, risk flags, plans, and jobs" },
  "/dashboard/settings": { title: "Settings", subtitle: "Platform and scraper configuration" },
};

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, role } = useAdminAccess();
  const canAccessDashboard = role === "admin" || role === "moderator";

  useEffect(() => {
    if (!me.isFetched || me.isLoading) {
      return;
    }
    if (!canAccessDashboard) {
      router.replace("/");
    }
  }, [canAccessDashboard, me.isFetched, me.isLoading, router]);

  const header = useMemo(() => {
    const found = Object.keys(titles).find((route) => pathname === route || pathname.startsWith(`${route}/`));
    return found
      ? titles[found] ?? { title: "Admin", subtitle: "Platform workspace" }
      : { title: "Admin", subtitle: "Platform workspace" };
  }, [pathname]);

  if (!me.isFetched || me.isLoading || !canAccessDashboard) {
    return <div className="min-h-screen bg-background" />;
  }

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
