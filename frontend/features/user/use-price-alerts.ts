"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { userApi } from "@/lib/api/openapi-client";
import { authStore } from "@/store/auth.store";

export const userPriceAlertsKey = ["user", "price-alerts"] as const;

export const useUserPriceAlerts = () =>
  useQuery({
    queryKey: userPriceAlertsKey,
    queryFn: async () => {
      try {
        const { data } = await userApi.priceAlerts({ channel: "telegram", limit: 500 });
        return data;
      } catch (error) {
        const normalized = error as { status?: number };
        if (normalized.status === 401) return [];
        throw error;
      }
    },
    retry: false,
    enabled: authStore((s) => s.isAuthenticated),
  });

export const useUpsertUserPriceAlert = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      productId: string;
      alerts_enabled?: boolean;
      target_price?: number | null;
      baseline_price?: number | null;
      current_price?: number | null;
      channel?: "telegram" | "email";
    }) =>
      userApi.upsertPriceAlert(payload.productId, {
        alerts_enabled: payload.alerts_enabled,
        target_price: payload.target_price,
        baseline_price: payload.baseline_price,
        current_price: payload.current_price,
        channel: payload.channel ?? "telegram",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userPriceAlertsKey });
    },
  });
};

export const useDeleteUserPriceAlert = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => userApi.deletePriceAlert(alertId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userPriceAlertsKey });
    },
  });
};

