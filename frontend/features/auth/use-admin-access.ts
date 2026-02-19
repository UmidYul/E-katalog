"use client";

import { useMemo } from "react";

import { useAuthMe, useLogout } from "@/features/auth/use-auth";

export function useAdminAccess() {
  const me = useAuthMe();
  const logout = useLogout();

  const role = useMemo<"admin" | "moderator">(() => {
    const raw = (me.data as { role?: string } | undefined)?.role;
    if (raw === "moderator") return "moderator";
    return "admin";
  }, [me.data]);

  return {
    me,
    logout,
    role,
    canManageSettings: role === "admin",
  };
}
