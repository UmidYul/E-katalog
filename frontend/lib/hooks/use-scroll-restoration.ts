"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function useScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    const key = `scroll:${pathname}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      window.scrollTo({ top: Number(saved), behavior: "instant" as ScrollBehavior });
    }
    return () => {
      sessionStorage.setItem(key, String(window.scrollY));
    };
  }, [pathname]);
}

