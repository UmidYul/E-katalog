"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";

export function useAdminStores() {
  return useQuery({
    queryKey: ["admin", "stores"],
    queryFn: async () => {
      const { data } = await adminApi.stores({ page: 1, limit: 100 });
      return data.items ?? [];
    },
  });
}

export function useCreateAdminStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createStore,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "stores"] }),
  });
}

export function useUpdateAdminStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) => adminApi.updateStore(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "stores"] }),
  });
}

export function useDeleteAdminStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminApi.deleteStore,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "stores"] }),
  });
}

export function useStoreSources(storeId: number | null) {
  return useQuery({
    queryKey: ["admin", "stores", storeId, "sources"],
    enabled: storeId !== null,
    queryFn: async () => {
      if (!storeId) return [];
      const { data } = await adminApi.storeSources(storeId, { page: 1, limit: 200 });
      return data.items ?? [];
    },
  });
}

export function useCreateStoreSource(storeId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { url: string; source_type?: string; priority?: number; is_active?: boolean }) => {
      if (!storeId) throw new Error("Store is required");
      return adminApi.createStoreSource(storeId, payload);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "stores", storeId, "sources"] }),
  });
}

export function useUpdateStoreSource(storeId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, payload }: { sourceId: number; payload: Record<string, unknown> }) => {
      if (!storeId) throw new Error("Store is required");
      return adminApi.updateStoreSource(storeId, sourceId, payload);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "stores", storeId, "sources"] }),
  });
}

export function useDeleteStoreSource(storeId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: number) => {
      if (!storeId) throw new Error("Store is required");
      return adminApi.deleteStoreSource(storeId, sourceId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "stores", storeId, "sources"] }),
  });
}
