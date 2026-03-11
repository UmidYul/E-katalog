"use client";

import Link from "next/link";
import { Send, Youtube } from "lucide-react";
import { useMemo } from "react";

import { useT } from "@/components/common/locale-provider";

export function SiteFooter() {
  const t = useT("footer");
  const year = new Date().getUTCFullYear();

  const footerLinks = useMemo(
    () => ({
      [t("aboutTitle")]: [
        { href: "/", label: t("aboutDoxx") },
        { href: "/contacts", label: t("contacts") },
        { href: "/status", label: t("status") },
        { href: "/become-seller", label: t("becomeSeller") },
      ],
      [t("catalogTitle")]: [
        { href: "/catalog", label: t("allProducts") },
        { href: "/compare", label: t("compare") },
        { href: "/favorites", label: t("favorites") },
        { href: "/recently-viewed", label: t("history") },
      ],
      [t("accountTitle")]: [
        { href: "/profile", label: t("profile") },
        { href: "/login", label: t("login") },
        { href: "/register", label: t("register") },
      ],
      [t("legalTitle")]: [
        { href: "/privacy", label: t("privacy") },
        { href: "/terms", label: t("terms") },
        { href: "/cookies", label: t("cookies") },
      ],
    }),
    [t]
  );

  return (
    <footer style={{ backgroundColor: "#0D1117", color: "#9BA3B5" }}>
      <div className="mx-auto max-w-[1280px] px-4 py-16">
        {/* Top: logo + tagline */}
        <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Doxx">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent shadow-sm">
                <span className="font-heading text-lg font-bold text-white">D</span>
              </div>
              <span className="font-heading text-xl font-bold text-white">Doxx</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed" style={{ color: "#5A6478" }}>
              {t("tagline")}
            </p>
          </div>

          {/* Social links */}
          <div className="flex items-center gap-2">
            <a
              href="#"
              className="flex h-9 w-9 items-center justify-center rounded-md transition-colors"
              style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "#9BA3B5" }}
              aria-label="VK"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#2563EB"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "#9BA3B5"; }}
            >
              <span className="text-xs font-bold">VK</span>
            </a>
            <a
              href="#"
              className="flex h-9 w-9 items-center justify-center rounded-md transition-colors"
              style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "#9BA3B5" }}
              aria-label="Telegram"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#2563EB"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "#9BA3B5"; }}
            >
              <Send className="h-4 w-4" />
            </a>
            <a
              href="#"
              className="flex h-9 w-9 items-center justify-center rounded-md transition-colors"
              style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "#9BA3B5" }}
              aria-label="YouTube"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#2563EB"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "#9BA3B5"; }}
            >
              <Youtube className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Links grid */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="mb-4 text-sm font-semibold text-white">{title}</h3>
              <ul className="flex flex-col gap-2.5">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm transition-colors hover:text-white"
                      style={{ color: "#5A6478" }}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div
          className="mt-12 flex flex-col items-center justify-between gap-4 border-t pt-8 sm:flex-row"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          <p className="text-xs" style={{ color: "#5A6478" }}>
            {t("rights", { year })}
          </p>
          <div className="flex items-center gap-2">
            {["Visa", "Mastercard", "МИР", "SBP"].map((method) => (
              <span
                key={method}
                className="rounded px-2.5 py-1 text-xs font-medium"
                style={{ border: "1px solid rgba(255,255,255,0.12)", color: "#5A6478" }}
              >
                {method}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
