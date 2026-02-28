"use client";

import { useMemo } from "react";

import { useAuthMe, useLogout } from "@/features/auth/use-auth";

export function useAdminAccess() {
  const me = useAuthMe();
  const logout = useLogout();

  const role = useMemo<"admin" | "moderator" | "seller_support" | "seller" | "user">(() => {
    const raw = String((me.data as { role?: string } | undefined)?.role ?? "").trim().toLowerCase().replace("-", "_");
    if (raw === "admin") return "admin";
    if (raw === "seller_support") return "seller_support";
    if (raw === "moderator") return "moderator";
    if (raw === "seller") return "seller";
    return "user";
  }, [me.data]);

  return {
    me,
    logout,
    role,
    canManageSettings: role === "admin",
  };
}
