"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";
import type { AdminSettings } from "@/types/admin";

const fallback: AdminSettings = {
  site_name: "Doxx",
  support_email: "support@example.com",
  branding_logo_url: null,
  feature_ai_enabled: true,
  api_keys: [],
};

export function useAdminSettings() {
  return useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      try {
        const { data } = await adminApi.settings();
        return data;
      } catch {
        return fallback;
      }
    },
  });
}

export function useUpdateAdminSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<AdminSettings>) => adminApi.updateSettings(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "settings"] }),
  });
}
