import Link from "next/link";
import type { ReactNode } from "react";

const links = [
  { href: "/b2b", label: "Dashboard" },
  { href: "/b2b/onboarding", label: "Onboarding" },
  { href: "/b2b/feeds", label: "Feeds" },
  { href: "/b2b/campaigns", label: "Campaigns" },
  { href: "/b2b/billing", label: "Billing" },
];

export default function B2BLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">B2B Cabinet</h1>
        <p className="mt-1 text-sm text-slate-600">Merchant onboarding, campaigns, billing and support.</p>
        <nav className="mt-4 flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
