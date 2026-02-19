"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";
import type { AdminCategory } from "@/types/admin";

export function useAdminCategories() {
  return useQuery({
    queryKey: ["admin", "categories"],
    queryFn: async () => {
      const { data } = await adminApi.categories();
      return (data as AdminCategory[]).map((item) => ({ ...item, is_active: item.is_active ?? true }));
    },
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "categories"] }),
  });
}
