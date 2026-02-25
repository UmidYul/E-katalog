"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";
import type {
  AdminAlertsAnalytics,
  AdminCatalogQualityAnalytics,
  AdminMetrics,
  AdminModerationAnalytics,
  AdminOperationsAnalytics,
  AdminOverviewAnalytics,
  AdminRevenueAnalytics,
  AdminUsersAnalytics,
  AlertSource,
  AlertStatus,
  AnalyticsGranularity,
  AnalyticsPeriod,
  Severity,
} from "@/types/admin";

const fallback: AdminMetrics = {
  total_users: 0,
  total_orders: 0,
  total_products: 0,
  revenue: 0,
  trend: [],
  quality_report: null,
  recent_activity: [],
};

export function useAdminAnalytics(period: "7d" | "30d" | "90d" | "365d") {
  return useQuery({
    queryKey: ["admin", "analytics", period],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analytics(period);
        return data;
      } catch {
        return fallback;
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

const emptyOverview: AdminOverviewAnalytics = {
  period: "30d",
  range: { from: "", to: "", days: 30 },
  kpis: {
    revenue: 0,
    orders: 0,
    aov: 0,
    active_products: 0,
    quality_risk_ratio: 0,
    moderation_pending: 0,
  },
  revenue_series: [],
  orders_by_status: [],
  quality_series: [],
  moderation_series: [],
  alerts_preview: [],
  generated_at: "",
};

const emptyRevenue: AdminRevenueAnalytics = {
  period: "30d",
  granularity: "day",
  range: { from: "", to: "", days: 30 },
  summary: { revenue: 0, orders: 0, aov: 0, cancel_rate: 0, cancelled_orders: 0 },
  series: [],
  orders_by_status: [],
  top_stores: [],
  top_categories: [],
  top_brands: [],
  generated_at: "",
};

const emptyCatalogQuality: AdminCatalogQualityAnalytics = {
  period: "30d",
  range: { from: "", to: "", days: 30 },
  latest_report: null,
  summary: {
    active_without_valid_offers_ratio: 0,
    search_mismatch_ratio: 0,
    stale_offer_ratio: 0,
    low_quality_image_ratio: 0,
    active_without_valid_offers: 0,
    search_mismatch_products: 0,
    stale_valid_offers: 0,
    low_quality_main_image_products: 0,
  },
  timeline: [],
  no_valid_offer_breakdown: [],
  problem_products: [],
  generated_at: "",
};

const emptyOperations: AdminOperationsAnalytics = {
  period: "30d",
  range: { from: "", to: "", days: 30 },
  summary: {
    runs_total: 0,
    failed_runs: 0,
    success_rate: 1,
    failed_task_rate_24h: 0,
    active_sources: 0,
    total_sources: 0,
  },
  status_breakdown: [],
  duration_series: [],
  latest_quality_status: null,
  pipeline_actions: [],
  generated_at: "",
};

const emptyModeration: AdminModerationAnalytics = {
  period: "30d",
  range: { from: "", to: "", days: 30 },
  summary: {
    total: 0,
    pending: 0,
    published: 0,
    rejected: 0,
    throughput_24h: 0,
    median_moderation_minutes: 0,
    publish_reject_ratio: 0,
  },
  kind_counts: {},
  status_counts: {},
  series: [],
  generated_at: "",
};

const emptyUsers: AdminUsersAnalytics = {
  period: "30d",
  range: { from: "", to: "", days: 30 },
  summary: {
    total_users: 0,
    new_users: 0,
    active_users_30d: 0,
    inactive_users_30d: 0,
  },
  role_distribution: [],
  created_series: [],
  activity_series: [],
  generated_at: "",
};

const emptyAlerts: AdminAlertsAnalytics = {
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
  changes: { opened: 0, updated: 0, resolved: 0 },
  generated_at: "",
};

export function useAdminOverviewAnalytics(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: ["admin", "analytics", "overview", period],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analyticsOverview(period);
        return data;
      } catch {
        return emptyOverview;
      }
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useAdminRevenueAnalytics(period: AnalyticsPeriod, granularity: AnalyticsGranularity) {
  return useQuery({
    queryKey: ["admin", "analytics", "revenue", period, granularity],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analyticsRevenue(period, granularity);
        return data;
      } catch {
        return emptyRevenue;
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAdminCatalogQualityAnalytics(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: ["admin", "analytics", "catalog-quality", period],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analyticsCatalogQuality(period);
        return data;
      } catch {
        return emptyCatalogQuality;
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAdminOperationsAnalytics(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: ["admin", "analytics", "operations", period],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analyticsOperations(period);
        return data;
      } catch {
        return emptyOperations;
      }
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useAdminModerationAnalytics(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: ["admin", "analytics", "moderation", period],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analyticsModeration(period);
        return data;
      } catch {
        return emptyModeration;
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAdminUsersAnalytics(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: ["admin", "analytics", "users", period],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analyticsUsers(period);
        return data;
      } catch {
        return emptyUsers;
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAdminAlertEvents(query: {
  status: AlertStatus;
  severity?: Severity;
  source?: AlertSource;
  code?: string;
  limit?: number;
  offset?: number;
  refresh?: boolean;
}) {
  return useQuery({
    queryKey: ["admin", "analytics", "alerts", query],
    queryFn: async () => {
      try {
        const { data } = await adminApi.analyticsAlerts(query);
        return data;
      } catch {
        return emptyAlerts;
      }
    },
    refetchInterval: query.status === "open" ? 30_000 : 60_000,
    staleTime: 15_000,
  });
}

export function useAcknowledgeAdminAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await adminApi.ackAnalyticsAlert(id)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics", "alerts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics", "overview"] });
    },
  });
}

export function useResolveAdminAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await adminApi.resolveAnalyticsAlert(id)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics", "alerts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics", "overview"] });
    },
  });
}
