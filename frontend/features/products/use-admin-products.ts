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
    mutationFn: (id: string) => adminApi.deleteProduct(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "products"] }),
  });
}

export function useBulkDeleteProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productIds: string[]) => adminApi.bulkDeleteProducts(productIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "products"] }),
  });
}

export function useRunAdminTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: "reindex" | "embedding" | "dedupe" | "scrape" | "catalog" | "quality" | "quality_alert_test") => {
      if (task === "reindex") return adminApi.runReindex();
      if (task === "embedding") return adminApi.runEmbeddingRebuild();
      if (task === "dedupe") return adminApi.runDedupe();
      if (task === "catalog") return adminApi.runCatalogRebuild();
      if (task === "quality") return adminApi.runQualityReport();
      if (task === "quality_alert_test") return adminApi.runQualityAlertTest();
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

export function useAdminProductsWithoutValidOffers(query: { limit?: number; offset?: number; active_only?: boolean } = {}) {
  return useQuery({
    queryKey: ["admin", "quality", "without-valid-offers", query],
    queryFn: async () => (await adminApi.qualityProductsWithoutValidOffers(query)).data,
  });
}

export function useDeactivateProductsWithoutValidOffers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productIds: string[]) =>
      adminApi.deactivateQualityProductsWithoutValidOffers({
        product_ids: productIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "quality", "without-valid-offers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "products"] });
    },
  });
}
