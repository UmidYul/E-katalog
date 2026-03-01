"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminSellersApi } from "@/lib/api/openapi-client";

export const adminSellersKeys = {
  applications: (
    status: string,
    q: string,
    countryCode: string,
    createdFrom: string,
    createdTo: string,
    duplicatesOnly: string,
    sortBy: string,
    limit: number,
    offset: number,
  ) => ["admin", "sellers", "applications", status, q, countryCode, createdFrom, createdTo, duplicatesOnly, sortBy, limit, offset] as const,
  applicationsSummary: (status: string, q: string, countryCode: string, createdFrom: string, createdTo: string) =>
    ["admin", "sellers", "applications-summary", status, q, countryCode, createdFrom, createdTo] as const,
  applicationHistory: (applicationId: string, limit: number, offset: number) =>
    ["admin", "sellers", "application-history", applicationId, limit, offset] as const,
  shops: (limit: number, offset: number) => ["admin", "sellers", "shops", limit, offset] as const,
  moderation: (status: string, q: string, limit: number, offset: number) =>
    ["admin", "sellers", "moderation", status, q, limit, offset] as const,
  moderationHistory: (productId: string, limit: number, offset: number) =>
    ["admin", "sellers", "moderation-history", productId, limit, offset] as const,
  finance: (limit: number, offset: number) => ["admin", "sellers", "finance", limit, offset] as const,
  tariffs: ["admin", "sellers", "tariffs"] as const,
  assignments: (limit: number) => ["admin", "sellers", "tariff-assignments", limit] as const,
};

export function useAdminSellerApplications(
  query: {
    status?: string;
    q?: string;
    country_code?: string;
    created_from?: string;
    created_to?: string;
    duplicates_only?: boolean;
    sort_by?: "recent" | "oldest" | "age_desc" | "age_asc" | "company_asc" | "company_desc" | "priority_desc";
    limit?: number;
    offset?: number;
  } = {},
) {
  const status = query.status ?? "all";
  const q = query.q ?? "";
  const countryCode = query.country_code ?? "";
  const createdFrom = query.created_from ?? "";
  const createdTo = query.created_to ?? "";
  const duplicatesOnly = query.duplicates_only ? "1" : "0";
  const sortBy = query.sort_by ?? "recent";
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const normalizedQ = q.trim().length >= 2 ? q.trim() : "";

  return useQuery({
    queryKey: adminSellersKeys.applications(status, q, countryCode, createdFrom, createdTo, duplicatesOnly, sortBy, limit, offset),
    queryFn: async () =>
      (
        await adminSellersApi.applications({
          status: status === "all" ? undefined : status,
          q: normalizedQ || undefined,
          country_code: countryCode || undefined,
          created_from: createdFrom || undefined,
          created_to: createdTo || undefined,
          duplicates_only: query.duplicates_only ? true : undefined,
          sort_by: sortBy,
          limit,
          offset,
        })
      ).data,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAdminSellerApplicationsSummary(
  query: {
    status?: string;
    q?: string;
    country_code?: string;
    created_from?: string;
    created_to?: string;
  } = {},
) {
  const status = query.status ?? "all";
  const q = query.q ?? "";
  const countryCode = query.country_code ?? "";
  const createdFrom = query.created_from ?? "";
  const createdTo = query.created_to ?? "";
  const normalizedQ = q.trim().length >= 2 ? q.trim() : "";
  return useQuery({
    queryKey: adminSellersKeys.applicationsSummary(status, q, countryCode, createdFrom, createdTo),
    queryFn: async () =>
      (
        await adminSellersApi.applicationsSummary({
          status: status === "all" ? undefined : status,
          q: normalizedQ || undefined,
          country_code: countryCode || undefined,
          created_from: createdFrom || undefined,
          created_to: createdTo || undefined,
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
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "application-history"] });
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
      await queryClient.invalidateQueries({ queryKey: ["admin", "sellers", "application-history"] });
    },
  });
}

export function useAdminSellerApplicationHistory(applicationId?: string, query: { limit?: number; offset?: number } = {}) {
  const normalizedApplicationId = applicationId ?? "";
  const limit = query.limit ?? 30;
  const offset = query.offset ?? 0;
  return useQuery({
    queryKey: adminSellersKeys.applicationHistory(normalizedApplicationId, limit, offset),
    queryFn: async () => {
      if (!normalizedApplicationId) {
        throw new Error("application id is required");
      }
      return (await adminSellersApi.applicationHistory(normalizedApplicationId, { limit, offset })).data;
    },
    enabled: Boolean(normalizedApplicationId),
    staleTime: 10_000,
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
