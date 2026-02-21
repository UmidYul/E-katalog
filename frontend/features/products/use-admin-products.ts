"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";

export function useAdminProducts(query: { q?: string; page?: number; limit?: number; sort?: string }) {
  return useQuery({
    queryKey: ["admin", "products", query],
    queryFn: async () => (await adminApi.products(query)).data,
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminApi.deleteProduct(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "products"] }),
  });
}

export function useBulkDeleteProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productIds: number[]) => adminApi.bulkDeleteProducts(productIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "products"] }),
  });
}

export function useRunAdminTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: "reindex" | "embedding" | "dedupe" | "scrape" | "catalog") => {
      if (task === "reindex") return adminApi.runReindex();
      if (task === "embedding") return adminApi.runEmbeddingRebuild();
      if (task === "dedupe") return adminApi.runDedupe();
      if (task === "catalog") return adminApi.runCatalogRebuild();
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
