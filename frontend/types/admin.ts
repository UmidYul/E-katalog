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
