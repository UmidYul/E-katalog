"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  BarChart3,
  Building2,
  CreditCard,
  Handshake,
  Megaphone,
  Network,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

const nav = [
  { href: "/seller", label: "Overview", icon: BarChart3 },
  { href: "/seller/onboarding", label: "Onboarding", icon: UserRoundCheck },
  { href: "/seller/feeds", label: "Feeds", icon: Network },
  { href: "/seller/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/seller/billing", label: "Billing", icon: CreditCard },
  { href: "/seller/support", label: "Support", icon: ShieldCheck },
];

const secondaryNav = [{ href: "/partners", label: "Partner Form", icon: Handshake }];

export function SellerSidebar({ open }: { open: boolean }) {
  const pathname = usePathname();

  return (
    <motion.aside
      animate={{ width: open ? 264 : 90 }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
      className="sticky top-0 hidden h-screen shrink-0 border-r border-slate-200 bg-white p-4 lg:block"
    >
      <div className={cn("mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-4", !open && "p-3")}>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">{open ? "Seller Panel" : "SP"}</p>
        {open ? (
          <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
            <Building2 className="h-4 w-4 text-cyan-700" />
            Doxx B2B
          </p>
        ) : null}
      </div>

      <nav className="space-y-2">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition",
                active
                  ? "bg-slate-900 text-white shadow-[0_12px_28px_-18px_rgba(15,23,42,0.9)]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {open ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-slate-200 pt-4">
        {secondaryNav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition",
                active
                  ? "bg-cyan-700 text-white shadow-[0_12px_28px_-18px_rgba(8,145,178,0.8)]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {open ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </div>
    </motion.aside>
  );
}

