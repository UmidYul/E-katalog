"use client";

import { ReactNode, useMemo } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AdminFooter } from "@/components/layout/admin-footer";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopbar } from "@/components/layout/admin-topbar";
import { useAdminAccess } from "@/features/auth/use-admin-access";

const titles: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Executive Hub", subtitle: "Ключевые KPI, риски и приоритеты платформы" },
  "/dashboard/users": { title: "Пользователи", subtitle: "Аккаунты, роли и активность" },
  "/dashboard/products": { title: "Товары", subtitle: "Канонические товары и офферы магазинов" },
  "/dashboard/categories": { title: "Категории", subtitle: "Таксономия каталога и структура" },
  "/dashboard/orders": { title: "Заказы", subtitle: "Поток заказов и статусы" },
  "/dashboard/feedback": { title: "Модерация", subtitle: "Очередь отзывов и вопросов" },
  "/dashboard/analytics": { title: "Аналитика 360", subtitle: "Revenue, Quality, Operations, Moderation, Users" },
  "/dashboard/settings": { title: "Настройки", subtitle: "Параметры платформы и источников" },
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
      ? titles[found] ?? { title: "Админка", subtitle: "Рабочее пространство платформы" }
      : { title: "Админка", subtitle: "Рабочее пространство платформы" };
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
