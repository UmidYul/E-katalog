"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { b2bApi } from "@/lib/api/openapi-client";

export const b2bKeys = {
  me: ["b2b", "me"] as const,
  feeds: (orgId?: string) => ["b2b", "feeds", orgId ?? "default"] as const,
  campaigns: (orgId?: string) => ["b2b", "campaigns", orgId ?? "default"] as const,
  plans: ["b2b", "plans"] as const,
  invoices: (orgId?: string) => ["b2b", "invoices", orgId ?? "default"] as const,
  acts: (orgId?: string) => ["b2b", "acts", orgId ?? "default"] as const,
  tickets: (orgId?: string) => ["b2b", "tickets", orgId ?? "default"] as const,
  analyticsOverview: (orgId?: string, periodDays: number = 30) => ["b2b", "analytics-overview", orgId ?? "default", periodDays] as const,
};

export const useB2BMe = () =>
  useQuery({
    queryKey: b2bKeys.me,
    queryFn: async () => (await b2bApi.me()).data,
  });

export const useB2BFeeds = (orgId?: string) =>
  useQuery({
    queryKey: b2bKeys.feeds(orgId),
    queryFn: async () => (await b2bApi.feeds({ org_id: orgId })).data,
    enabled: Boolean(orgId),
  });

export const useB2BCampaigns = (orgId?: string) =>
  useQuery({
    queryKey: b2bKeys.campaigns(orgId),
    queryFn: async () => (await b2bApi.campaigns({ org_id: orgId })).data,
    enabled: Boolean(orgId),
  });

export const useB2BPlans = () =>
  useQuery({
    queryKey: b2bKeys.plans,
    queryFn: async () => (await b2bApi.billingPlans()).data,
  });

export const useB2BInvoices = (orgId?: string) =>
  useQuery({
    queryKey: b2bKeys.invoices(orgId),
    queryFn: async () => (await b2bApi.invoices({ org_id: orgId, limit: 100, offset: 0 })).data,
    enabled: Boolean(orgId),
  });

export const useB2BActs = (orgId?: string) =>
  useQuery({
    queryKey: b2bKeys.acts(orgId),
    queryFn: async () => (await b2bApi.acts({ org_id: orgId })).data,
    enabled: Boolean(orgId),
  });

export const useB2BTickets = (orgId?: string) =>
  useQuery({
    queryKey: b2bKeys.tickets(orgId),
    queryFn: async () => (await b2bApi.tickets({ org_id: orgId, limit: 100, offset: 0 })).data,
    enabled: Boolean(orgId),
  });

export const useB2BAnalyticsOverview = (orgId?: string, periodDays: number = 30) =>
  useQuery({
    queryKey: b2bKeys.analyticsOverview(orgId, periodDays),
    queryFn: async () => (await b2bApi.analyticsOverview({ org_id: orgId, period_days: periodDays })).data,
    enabled: Boolean(orgId),
  });

export const usePayB2BInvoice = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { invoiceId: string; provider?: string; amount?: number }) =>
      (await b2bApi.payInvoice(payload.invoiceId, { provider: payload.provider ?? "manual", amount: payload.amount }, orgId)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.invoices(orgId) });
      await queryClient.invalidateQueries({ queryKey: b2bKeys.acts(orgId) });
      await queryClient.invalidateQueries({ queryKey: b2bKeys.me });
    },
  });
};
