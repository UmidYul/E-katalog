"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";
import type { AdminProduct } from "@/types/admin";
import type { Paginated } from "@/types/domain";

const fallbackProducts: Paginated<AdminProduct> = { items: [], next_cursor: null, request_id: "admin-fallback" };

export function useAdminProducts(query: { q?: string; page?: number; limit?: number; sort?: string }) {
  return useQuery({
    queryKey: ["admin", "products", query],
    queryFn: async () => {
      try {
        const { data } = await adminApi.products(query);
        return data;
      } catch {
        return fallbackProducts;
      }
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminApi.deleteProduct(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "products"] }),
  });
}

export function useRunAdminTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: "reindex" | "embedding" | "dedupe" | "scrape") => {
      if (task === "reindex") return adminApi.runReindex();
      if (task === "embedding") return adminApi.runEmbeddingRebuild();
      if (task === "dedupe") return adminApi.runDedupe();
      return adminApi.runScrape();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useAdminTaskStatus(taskId: string | null) {
  return useQuery({
    queryKey: ["admin", "task-status", taskId],
    enabled: Boolean(taskId),
    refetchInterval: (query) => {
      const state = (query.state.data as { state?: string } | undefined)?.state;
      if (!state) return 1500;
      if (["SUCCESS", "FAILURE", "REVOKED"].includes(state)) return false;
      return 1500;
    },
    queryFn: async () => {
      if (!taskId) return null;
      const { data } = await adminApi.taskStatus(taskId);
      return data;
    },
  });
}
