"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";
import type { AdminOrder } from "@/types/admin";
import type { Paginated } from "@/types/domain";

const fallbackOrders: Paginated<AdminOrder> = { items: [], next_cursor: null, request_id: "admin-fallback" };

export function useAdminOrders(query: { q?: string; page?: number; limit?: number; status?: string }) {
  return useQuery({
    queryKey: ["admin", "orders", query],
    queryFn: async () => {
      try {
        const { data } = await adminApi.orders(query);
        return data;
      } catch {
        return fallbackOrders;
      }
    },
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: AdminOrder["status"] }) => adminApi.updateOrderStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "orders"] }),
  });
}
