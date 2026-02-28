"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminSellersApi } from "@/lib/api/openapi-client";

export const adminSellersKeys = {
  applications: (status: string, q: string, sortBy: string, limit: number, offset: number) =>
    ["admin", "sellers", "applications", status, q, sortBy, limit, offset] as const,
  shops: (limit: number, offset: number) => ["admin", "sellers", "shops", limit, offset] as const,
  moderation: (status: string, q: string, limit: number, offset: number) =>
    ["admin", "sellers", "moderation", status, q, limit, offset] as const,
  moderationHistory: (productId: string, limit: number, offset: number) =>
    ["admin", "sellers", "moderation-history", productId, limit, offset] as const,
  finance: (limit: number, offset: number) => ["admin", "sellers", "finance", limit, offset] as const,
  tariffs: ["admin", "sellers", "tariffs"] as const,
  assignments: (limit: number) => ["admin", "sellers", "tariff-assignments", limit] as const,
};

export function useAdminSellerApplications(query: { status?: string; q?: string; sort_by?: "recent" | "oldest"; limit?: number; offset?: number } = {}) {
  const status = query.status ?? "all";
  const q = query.q ?? "";
  const sortBy = query.sort_by ?? "recent";
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  return useQuery({
    queryKey: adminSellersKeys.applications(status, q, sortBy, limit, offset),
    queryFn: async () =>
      (
        await adminSellersApi.applications({
          status: status === "all" ? undefined : status,
          q: q || undefined,
          sort_by: sortBy,
          limit,
          offset,
        })
      ).data,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAdminSellerShops(query: { limit?: number; offset?: number } = {}) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  return useQuery({
    queryKey: adminSellersKeys.shops(limit, offset),
    queryFn: async () => (await adminSellersApi.shops({ limit, offset })).data,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function usePatchAdminSellerApplicationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { applicationId: string; status: string; review_note?: string | null }) =>
      (await adminSellersApi.patchApplicationStatus(payload.applicationId, { status: payload.status, review_note: payload.review_note })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "applications"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "shops"] });
    },
  });
}

export function useBulkPatchAdminSellerApplicationsStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { application_ids: string[]; status: string; review_note?: string | null }) =>
      (
        await adminSellersApi.bulkPatchApplicationStatus({
          application_ids: payload.application_ids,
          status: payload.status as "pending" | "review" | "approved" | "rejected",
          review_note: payload.review_note,
        })
      ).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "applications"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "shops"] });
    },
  });
}

export function useAdminSellerProductModeration(query: { status?: string; q?: string; limit?: number; offset?: number } = {}) {
  const status = query.status ?? "pending_moderation";
  const q = query.q ?? "";
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  return useQuery({
    queryKey: adminSellersKeys.moderation(status, q, limit, offset),
    queryFn: async () => (await adminSellersApi.productModeration({ status, q: q || undefined, limit, offset })).data,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function usePatchAdminSellerProductModerationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { productId: string; status: string; moderation_comment?: string | null }) =>
      (await adminSellersApi.patchProductModerationStatus(payload.productId, { status: payload.status, moderation_comment: payload.moderation_comment })).data,
    onSuccess: async (_, payload) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "moderation"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "moderation-history", payload.productId] });
    },
  });
}

export function useAdminSellerProductModerationHistory(productId?: string, query: { limit?: number; offset?: number } = {}) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const normalizedProductId = productId ?? "";
  return useQuery({
    queryKey: adminSellersKeys.moderationHistory(normalizedProductId, limit, offset),
    queryFn: async () => {
      if (!normalizedProductId) {
        throw new Error("product id is required");
      }
      return (await adminSellersApi.productModerationStatusHistory(normalizedProductId, { limit, offset })).data;
    },
    enabled: Boolean(normalizedProductId),
    staleTime: 10_000,
  });
}

export function useAdminSellerFinance(query: { limit?: number; offset?: number } = {}) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  return useQuery({
    queryKey: adminSellersKeys.finance(limit, offset),
    queryFn: async () => (await adminSellersApi.finance({ limit, offset })).data,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAdminSellerTariffs() {
  return useQuery({
    queryKey: adminSellersKeys.tariffs,
    queryFn: async () => (await adminSellersApi.tariffs()).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAdminSellerTariffAssignments(query: { limit?: number } = {}) {
  const limit = query.limit ?? 100;
  return useQuery({
    queryKey: adminSellersKeys.assignments(limit),
    queryFn: async () => (await adminSellersApi.tariffAssignments({ limit })).data,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAssignAdminSellerTariff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { shopId: string; plan_code: string }) => (await adminSellersApi.assignTariff(payload.shopId, { plan_code: payload.plan_code })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "tariff-assignments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "finance"] });
    },
  });
}
