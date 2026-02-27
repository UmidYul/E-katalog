"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { b2bApi } from "@/lib/api/openapi-client";

export const b2bKeys = {
  me: ["b2b", "me"] as const,
  feeds: (orgId?: string) => ["b2b", "feeds", orgId ?? "default"] as const,
  feedRuns: (feedId?: string, orgId?: string) => ["b2b", "feed-runs", orgId ?? "default", feedId ?? "none"] as const,
  campaigns: (orgId?: string) => ["b2b", "campaigns", orgId ?? "default"] as const,
  plans: ["b2b", "plans"] as const,
  invoices: (orgId?: string) => ["b2b", "invoices", orgId ?? "default"] as const,
  acts: (orgId?: string) => ["b2b", "acts", orgId ?? "default"] as const,
  tickets: (orgId?: string, status?: string) => ["b2b", "tickets", orgId ?? "default", status ?? "all"] as const,
  analyticsOverview: (orgId?: string, periodDays: number = 30) => ["b2b", "analytics-overview", orgId ?? "default", periodDays] as const,
  analyticsOffers: (orgId?: string, limit: number = 10) => ["b2b", "analytics-offers", orgId ?? "default", limit] as const,
  analyticsAttribution: (orgId?: string, periodDays: number = 30) =>
    ["b2b", "analytics-attribution", orgId ?? "default", periodDays] as const,
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

export const useB2BFeedRuns = (feedId?: string, orgId?: string) =>
  useQuery({
    queryKey: b2bKeys.feedRuns(feedId, orgId),
    queryFn: async () => {
      if (!feedId) return [];
      return (await b2bApi.feedRuns(feedId, orgId)).data;
    },
    enabled: Boolean(feedId && orgId),
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

export const useB2BTickets = (orgId?: string, status?: string) =>
  useQuery({
    queryKey: b2bKeys.tickets(orgId, status),
    queryFn: async () => (await b2bApi.tickets({ org_id: orgId, status, limit: 100, offset: 0 })).data,
    enabled: Boolean(orgId),
  });

export const useB2BAnalyticsOverview = (orgId?: string, periodDays: number = 30) =>
  useQuery({
    queryKey: b2bKeys.analyticsOverview(orgId, periodDays),
    queryFn: async () => (await b2bApi.analyticsOverview({ org_id: orgId, period_days: periodDays })).data,
    enabled: Boolean(orgId),
  });

export const useB2BAnalyticsOffers = (orgId?: string, limit: number = 10) =>
  useQuery({
    queryKey: b2bKeys.analyticsOffers(orgId, limit),
    queryFn: async () => (await b2bApi.analyticsOffers({ org_id: orgId, limit })).data,
    enabled: Boolean(orgId),
  });

export const useB2BAnalyticsAttribution = (orgId?: string, periodDays: number = 30) =>
  useQuery({
    queryKey: b2bKeys.analyticsAttribution(orgId, periodDays),
    queryFn: async () => (await b2bApi.analyticsAttribution({ org_id: orgId, period_days: periodDays })).data,
    enabled: Boolean(orgId),
  });

export const useCreateB2BOrg = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      slug: string;
      legal_name?: string | null;
      tax_id?: string | null;
      website_url?: string | null;
    }) => (await b2bApi.createOrg(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.me });
    },
  });
};

export const useInviteB2BMember = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { email: string; role: string; expires_in_days?: number }) => {
      if (!orgId) {
        throw new Error("Organization id is required");
      }
      return (await b2bApi.inviteMember(orgId, payload)).data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.me });
    },
  });
};

export const usePatchB2BMember = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { memberId: string; role?: string; status?: string }) => {
      if (!orgId) {
        throw new Error("Organization id is required");
      }
      return (await b2bApi.patchMember(orgId, payload.memberId, { role: payload.role, status: payload.status })).data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.me });
    },
  });
};

export const useSubmitB2BOnboarding = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      org_id: string;
      company_name: string;
      legal_address?: string;
      billing_email: string;
      contact_name: string;
      contact_phone?: string;
      website_domain?: string;
      tax_id?: string;
      payout_details?: Record<string, unknown>;
      submit?: boolean;
    }) => (await b2bApi.submitOnboarding(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.me });
    },
  });
};

export const useUploadB2BOnboardingDocument = () =>
  useMutation({
    mutationFn: async (payload: {
      org_id: string;
      application_id?: string | null;
      document_type: string;
      storage_url: string;
      checksum?: string | null;
    }) => (await b2bApi.uploadOnboardingDocument(payload)).data,
  });

export const useAcceptB2BContract = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { org_id: string; contract_version: string }) => (await b2bApi.acceptContract(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.me });
    },
  });
};

export const useCreateB2BFeed = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      store_id: string;
      source_type?: string;
      source_url: string;
      schedule_cron?: string;
      auth_config?: Record<string, unknown>;
      is_active?: boolean;
    }) => {
      if (!orgId) {
        throw new Error("Organization id is required");
      }
      return (
        await b2bApi.createFeed({
          org_id: orgId,
          store_id: payload.store_id,
          source_type: payload.source_type,
          source_url: payload.source_url,
          schedule_cron: payload.schedule_cron,
          auth_config: payload.auth_config,
          is_active: payload.is_active,
        })
      ).data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.feeds(orgId) });
    },
  });
};

export const useValidateB2BFeed = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (feedId: string) => (await b2bApi.validateFeed(feedId, orgId)).data,
    onSuccess: async (_, feedId) => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.feeds(orgId) });
      await queryClient.invalidateQueries({ queryKey: b2bKeys.feedRuns(feedId, orgId) });
      await queryClient.invalidateQueries({ queryKey: ["b2b", "analytics-overview", orgId ?? "default"] });
    },
  });
};

export const useCreateB2BCampaign = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      store_id: string;
      name: string;
      daily_budget: number;
      monthly_budget: number;
      bid_default: number;
      bid_cap: number;
      pacing_mode?: "even" | "aggressive";
      starts_at?: string | null;
      ends_at?: string | null;
      targets?: Array<Record<string, unknown>>;
    }) => {
      if (!orgId) {
        throw new Error("Organization id is required");
      }
      return (
        await b2bApi.createCampaign({
          org_id: orgId,
          store_id: payload.store_id,
          name: payload.name,
          daily_budget: payload.daily_budget,
          monthly_budget: payload.monthly_budget,
          bid_default: payload.bid_default,
          bid_cap: payload.bid_cap,
          pacing_mode: payload.pacing_mode,
          starts_at: payload.starts_at,
          ends_at: payload.ends_at,
          targets: payload.targets,
        })
      ).data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.campaigns(orgId) });
      await queryClient.invalidateQueries({ queryKey: ["b2b", "analytics-overview", orgId ?? "default"] });
    },
  });
};

export const usePatchB2BCampaign = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      campaignId: string;
      status?: "draft" | "active" | "paused" | "archived";
      daily_budget?: number;
      monthly_budget?: number;
      bid_default?: number;
      bid_cap?: number;
      pacing_mode?: "even" | "aggressive";
      ends_at?: string | null;
    }) => {
      const { campaignId, ...body } = payload;
      return (await b2bApi.patchCampaign(campaignId, body, orgId)).data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.campaigns(orgId) });
      await queryClient.invalidateQueries({ queryKey: ["b2b", "analytics-overview", orgId ?? "default"] });
    },
  });
};

export const useSubscribeB2BPlan = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planCode: string) => {
      if (!orgId) {
        throw new Error("Organization id is required");
      }
      return (await b2bApi.subscribe({ org_id: orgId, plan_code: planCode })).data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: b2bKeys.invoices(orgId) });
      await queryClient.invalidateQueries({ queryKey: b2bKeys.acts(orgId) });
      await queryClient.invalidateQueries({ queryKey: b2bKeys.me });
    },
  });
};

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

export const useCreateB2BTicket = (orgId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { subject: string; category?: string; priority?: string; body: string }) => {
      if (!orgId) {
        throw new Error("Organization id is required");
      }
      return (
        await b2bApi.createTicket({
          org_id: orgId,
          subject: payload.subject,
          category: payload.category,
          priority: payload.priority,
          body: payload.body,
        })
      ).data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["b2b", "tickets", orgId ?? "default"] });
    },
  });
};

export const useCreateB2BPartnerLead = () =>
  useMutation({
    mutationFn: async (payload: {
      company_name: string;
      legal_name?: string | null;
      brand_name?: string | null;
      tax_id?: string | null;
      website_url?: string | null;
      contact_name: string;
      contact_role?: string | null;
      email: string;
      phone: string;
      telegram?: string | null;
      country_code?: string;
      city?: string | null;
      categories?: string[];
      monthly_orders?: number | null;
      avg_order_value?: number | null;
      feed_url?: string | null;
      logistics_model?: "own_warehouse" | "dropshipping" | "marketplace_fulfillment" | "hybrid";
      warehouses_count?: number | null;
      marketplaces?: string[];
      returns_policy?: string | null;
      goals?: string | null;
      notes?: string | null;
      accepts_terms: boolean;
    }) => (await b2bApi.createPartnerLead(payload)).data,
  });
