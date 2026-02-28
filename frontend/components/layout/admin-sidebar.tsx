"use client";

import { motion } from "framer-motion";
import { BarChart3, Boxes, LayoutDashboard, MessageSquare, Package, Settings, ShieldAlert, ShoppingCart, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";
import { useUiStore } from "@/store/ui.store";

const nav = [
  { href: "/dashboard/admin", label: "Hub", icon: LayoutDashboard },
  { href: "/dashboard/admin/users", label: "Users", icon: Users },
  { href: "/dashboard/admin/products", label: "Products", icon: Package },
  { href: "/dashboard/admin/categories", label: "Categories", icon: Boxes },
  { href: "/dashboard/admin/orders", label: "Orders", icon: ShoppingCart },
  { href: "/dashboard/admin/feedback", label: "Moderation", icon: MessageSquare },
  { href: "/dashboard/admin/analytics", label: "Analytics 360", icon: BarChart3 },
  { href: "/dashboard/admin/sellers", label: "Sellers", icon: ShieldAlert },
  { href: "/dashboard/admin/settings", label: "Settings", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const open = useUiStore((s) => s.dashboardSidebarOpen);

  return (
    <motion.aside
      animate={{ width: open ? 260 : 88 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
      className="sticky top-0 hidden h-screen shrink-0 border-r border-border bg-card/90 p-4 backdrop-blur lg:block"
    >
      <div className={cn("mb-6 rounded-2xl border border-border bg-background p-4", !open && "p-3")}>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{open ? "Doxx Admin" : "EA"}</p>
      </div>
      <nav className="space-y-2">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition",
                active ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {open ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>
    </motion.aside>
  );
}

