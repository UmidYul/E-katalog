"use client";

import { useQuery } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";
import type { AdminMetrics } from "@/types/admin";

const fallback: AdminMetrics = {
  total_users: 0,
  total_orders: 0,
  total_products: 0,
  revenue: 0,
  trend: [],
  recent_activity: [],
};

export function useAdminAnalytics(period: "7d" | "30d" | "90d" | "365d") {
  return useQuery({
    queryKey: ["admin", "analytics", period],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analytics(period);
        return data;
      } catch {
        return fallback;
      }
    },
  });
}
