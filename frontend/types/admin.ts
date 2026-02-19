export type AdminRole = "admin" | "moderator";

export type AdminUser = {
  id: number;
  email: string;
  full_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
  last_seen_at?: string | null;
};

export type AdminCategory = {
  id: number;
  name: string;
  slug: string;
  parent_id?: number | null;
  is_active: boolean;
};

export type AdminProduct = {
  id: number;
  normalized_title: string;
  status: string;
  brand?: { id: number; name: string } | null;
  category?: { id: number; name: string } | null;
  min_price?: number | null;
  max_price?: number | null;
  store_count: number;
  updated_at?: string;
};

export type AdminOrder = {
  id: number;
  user_id: number;
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
  recent_activity: Array<{ id: string; title: string; timestamp: string }>;
};

export type AdminSettings = {
  site_name: string;
  support_email: string;
  branding_logo_url?: string | null;
  feature_ai_enabled: boolean;
  api_keys: Array<{ id: string; name: string; masked_value: string }>;
};

export type AdminStore = {
  id: number;
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
  id: number;
  store_id: number;
  url: string;
  source_type: string;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
};
