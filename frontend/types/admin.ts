export type AdminRole = "admin" | "moderator" | "seller_support" | "user";

export type AdminUser = {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
  last_seen_at?: string | null;
};

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
  is_active: boolean;
};

export type AdminProduct = {
  id: string;
  normalized_title: string;
  status: string;
  brand?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
  min_price?: number | null;
  max_price?: number | null;
  store_count: number;
  updated_at?: string;
};

export type AdminOrder = {
  id: string;
  user_id: string;
  total_amount: number;
  currency: string;
  status: "new" | "processing" | "completed" | "cancelled";
  created_at: string;
};

export type AdminMetrics = {
  total_users: number;
  total_orders: number;
  total_products: number;
  revenue: number;
  trend: Array<{ label: string; value: number }>;
  quality_report?: {
    id: string;
    status: "ok" | "warning" | "critical" | string;
    summary: Record<string, unknown>;
    checks: Record<string, unknown>;
    created_at?: string | null;
  } | null;
  recent_activity: Array<{ id: string; title: string; timestamp: string }>;
};

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "365d";
export type AnalyticsGranularity = "day" | "week";
export type Severity = "info" | "warning" | "critical";

export type SeriesPoint = {
  ts: string;
  value: number;
};

export type AdminOverviewAnalytics = {
  period: AnalyticsPeriod;
  range: { from: string; to: string; days: number };
  kpis: {
    revenue: number;
    orders: number;
    aov: number;
    active_products: number;
    quality_risk_ratio: number;
    moderation_pending: number;
  };
  revenue_series: SeriesPoint[];
  orders_by_status: Array<{ status: string; count: number }>;
  quality_series: Array<{ ts: string; active_without_valid_offers_ratio: number; search_mismatch_ratio: number; low_quality_image_ratio: number }>;
  moderation_series: Array<{ ts: string; pending: number; published: number; rejected: number }>;
  alerts_preview: AdminAlertEvent[];
  generated_at: string;
};

export type AdminRevenueAnalytics = {
  period: AnalyticsPeriod;
  granularity: AnalyticsGranularity;
  range: { from: string; to: string; days: number };
  summary: {
    revenue: number;
    orders: number;
    aov: number;
    cancel_rate: number;
    cancelled_orders: number;
  };
  series: Array<{ ts: string; revenue: number; orders: number; aov: number; value: number }>;
  orders_by_status: Array<{ status: string; count: number }>;
  top_stores: Array<{ id: string; name: string; revenue_proxy: number; offers: number }>;
  top_categories: Array<{ id: string; name: string; revenue_proxy: number; offers: number }>;
  top_brands: Array<{ id: string; name: string; revenue_proxy: number; offers: number }>;
  generated_at: string;
};

export type AdminCatalogQualityAnalytics = {
  period: AnalyticsPeriod;
  range: { from: string; to: string; days: number };
  latest_report?: AdminMetrics["quality_report"] | null;
  summary: {
    active_without_valid_offers_ratio: number;
    search_mismatch_ratio: number;
    stale_offer_ratio: number;
    low_quality_image_ratio: number;
    active_without_valid_offers: number;
    search_mismatch_products: number;
    stale_valid_offers: number;
    low_quality_main_image_products: number;
  };
  timeline: Array<{ ts: string; active_without_valid_offers_ratio: number; search_mismatch_ratio: number; low_quality_image_ratio: number }>;
  no_valid_offer_breakdown: Array<{ category_id: string; category_name: string; products: number }>;
  problem_products: AdminQualityNoOfferItem[];
  generated_at: string;
};

export type AdminOperationsAnalytics = {
  period: AnalyticsPeriod;
  range: { from: string; to: string; days: number };
  summary: {
    runs_total: number;
    failed_runs: number;
    success_rate: number;
    failed_task_rate_24h: number;
    active_sources: number;
    total_sources: number;
  };
  status_breakdown: Array<{ status: string; count: number }>;
  duration_series: Array<{ ts: string; avg_duration_sec: number }>;
  latest_quality_status?: string | null;
  pipeline_actions: Array<{ task: string; label: string }>;
  generated_at: string;
};

export type AdminModerationAnalytics = {
  period: AnalyticsPeriod;
  range: { from: string; to: string; days: number };
  summary: {
    total: number;
    pending: number;
    published: number;
    rejected: number;
    throughput_24h: number;
    median_moderation_minutes: number;
    publish_reject_ratio: number;
  };
  kind_counts: Record<string, number>;
  status_counts: Record<string, number>;
  series: Array<{ ts: string; pending: number; published: number; rejected: number }>;
  generated_at: string;
};

export type AdminUsersAnalytics = {
  period: AnalyticsPeriod;
  range: { from: string; to: string; days: number };
  summary: {
    total_users: number;
    new_users: number;
    active_users_30d: number;
    inactive_users_30d: number;
  };
  role_distribution: Array<{ role: string; count: number }>;
  created_series: SeriesPoint[];
  activity_series: SeriesPoint[];
  generated_at: string;
};

export type AlertSource = "revenue" | "catalog_quality" | "operations" | "moderation" | "users";
export type AlertStatus = "open" | "ack" | "resolved";

export type AdminAlertEvent = {
  id: string;
  code: string;
  title: string;
  source: AlertSource;
  severity: Severity;
  status: AlertStatus;
  metric_value: number;
  threshold_value: number;
  context: Record<string, unknown>;
  created_at: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
};

export type AdminAlertsAnalytics = {
  items: AdminAlertEvent[];
  total: number;
  limit: number;
  offset: number;
  changes: {
    opened: number;
    updated: number;
    resolved: number;
  };
  generated_at: string;
};

export type AdminQualityNoOfferItem = {
  id: string;
  normalized_title: string;
  main_image?: string | null;
  is_active: boolean;
  valid_store_count: number;
  store_count: number;
  total_offers: number;
  last_offer_seen_at?: string | null;
  last_valid_offer_seen_at?: string | null;
  updated_at?: string | null;
  brand?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
};

export type AdminSettings = {
  site_name: string;
  support_email: string;
  branding_logo_url?: string | null;
  feature_ai_enabled: boolean;
  api_keys: Array<{ id: string; name: string; masked_value: string }>;
};

export type AdminStore = {
  id: string;
  slug: string;
  name: string;
  provider: string;
  base_url?: string | null;
  country_code: string;
  is_active: boolean;
  trust_score: number;
  crawl_priority: number;
  sources_count: number;
};

export type AdminScrapeSource = {
  id: string;
  store_id: string;
  url: string;
  source_type: string;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
};

export type AdminFeedbackKind = "review" | "question";
export type AdminFeedbackStatus = "published" | "pending" | "rejected" | string;

export type AdminFeedbackQueueItem = {
  kind: AdminFeedbackKind;
  id: string;
  product_id: string;
  author: string;
  body: string;
  rating?: number | null;
  status: AdminFeedbackStatus;
  created_at: string;
  updated_at: string;
  moderated_by?: string | null;
  moderated_at?: string | null;
};

export type AdminFeedbackQueueResponse = {
  items: AdminFeedbackQueueItem[];
  total: number;
  status_counts: Record<string, number>;
  kind_counts: Record<string, number>;
};
