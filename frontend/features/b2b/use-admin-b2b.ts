"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminB2bApi } from "@/lib/api/openapi-client";
import type {
  AdminB2BDispute,
  AdminB2BListResponse,
  AdminB2BOnboardingApplication,
  AdminB2BPartnerLead,
  AdminB2BRiskFlag,
  B2BBillingPlan,
} from "@/types/b2b";

const emptyListResponse = <T,>(): AdminB2BListResponse<T> => ({
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
});

export const adminB2BKeys = {
  onboarding: (status?: string, limit: number = 50, offset: number = 0) => ["admin", "b2b", "onboarding", status ?? "all", limit, offset] as const,
  partnerLeads: (status?: string, q?: string, limit: number = 50, offset: number = 0) =>
    ["admin", "b2b", "partner-leads", status ?? "all", q ?? "", limit, offset] as const,
  disputes: (status?: string, limit: number = 50, offset: number = 0) => ["admin", "b2b", "disputes", status ?? "all", limit, offset] as const,
  riskFlags: (level?: string, limit: number = 50, offset: number = 0) => ["admin", "b2b", "risk-flags", level ?? "all", limit, offset] as const,
  plans: ["admin", "b2b", "plans"] as const,
  jobs: ["admin", "b2b", "jobs"] as const,
};

export function useAdminB2BOnboardingApplications(query: { status?: string; limit?: number; offset?: number } = {}) {
  const status = query.status;
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  return useQuery({
    queryKey: adminB2BKeys.onboarding(status, limit, offset),
    queryFn: async () => {
      try {
        return (await adminB2bApi.onboardingApplications({ status, limit, offset })).data;
      } catch {
        return emptyListResponse<AdminB2BOnboardingApplication>();
      }
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAdminB2BDisputes(query: { status?: string; limit?: number; offset?: number } = {}) {
  const status = query.status;
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  return useQuery({
    queryKey: adminB2BKeys.disputes(status, limit, offset),
    queryFn: async () => {
      try {
        return (await adminB2bApi.disputes({ status, limit, offset })).data;
      } catch {
        return emptyListResponse<AdminB2BDispute>();
      }
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAdminB2BPartnerLeads(query: { status?: string; q?: string; limit?: number; offset?: number } = {}) {
  const status = query.status;
  const q = query.q;
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  return useQuery({
    queryKey: adminB2BKeys.partnerLeads(status, q, limit, offset),
    queryFn: async () => {
      try {
        return (await adminB2bApi.partnerLeads({ status, q, limit, offset })).data;
      } catch {
        return emptyListResponse<AdminB2BPartnerLead>();
      }
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAdminB2BRiskFlags(query: { level?: string; limit?: number; offset?: number } = {}) {
  const level = query.level;
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  return useQuery({
    queryKey: adminB2BKeys.riskFlags(level, limit, offset),
    queryFn: async () => {
      try {
        return (await adminB2bApi.riskFlags({ level, limit, offset })).data;
      } catch {
        return emptyListResponse<AdminB2BRiskFlag>();
      }
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAdminB2BPlans() {
  return useQuery({
    queryKey: adminB2BKeys.plans,
    queryFn: async () => {
      try {
        return (await adminB2bApi.plans()).data;
      } catch {
        return [] satisfies B2BBillingPlan[];
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function usePatchAdminB2BOnboardingApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { applicationId: string; status: string; rejection_reason?: string | null }) =>
      (await adminB2bApi.patchOnboardingApplication(payload.applicationId, { status: payload.status, rejection_reason: payload.rejection_reason })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "b2b", "onboarding"] });
    },
  });
}

export function usePatchAdminB2BDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { disputeId: string; status: string; resolution_note?: string | null }) =>
      (await adminB2bApi.patchDispute(payload.disputeId, { status: payload.status, resolution_note: payload.resolution_note })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "b2b", "disputes"] });
    },
  });
}

export function usePatchAdminB2BPartnerLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { leadId: string; status: string; review_note?: string | null }) =>
      (await adminB2bApi.patchPartnerLead(payload.leadId, { status: payload.status, review_note: payload.review_note })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "b2b", "partner-leads"] });
    },
  });
}

export function useUpsertAdminB2BPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      code: string;
      name: string;
      monthly_fee: number;
      included_clicks: number;
      click_price: number;
      limits?: Record<string, unknown>;
    }) => (await adminB2bApi.upsertPlan(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminB2BKeys.plans });
    },
  });
}

export function useRunAdminB2BJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (job: "invoices" | "acts" | "fraud-scan" | "feed-health") => {
      if (job === "invoices") return (await adminB2bApi.runInvoicesJob()).data;
      if (job === "acts") return (await adminB2bApi.runActsJob()).data;
      if (job === "fraud-scan") return (await adminB2bApi.runFraudScanJob()).data;
      return (await adminB2bApi.runFeedHealthJob()).data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "b2b"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    },
  });
}
