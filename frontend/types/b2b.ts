export type B2BRole = "owner" | "admin" | "marketing" | "analyst" | "finance" | "operator";

export type B2BMembershipStatus = "active" | "invited" | "disabled";

export type B2BOrg = {
  id: string;
  slug: string;
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  status: string;
  country_code: string;
  default_currency: string;
  website_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type B2BMembership = {
  id: string;
  org_id: string;
  user_id: string;
  role: B2BRole;
  status: B2BMembershipStatus;
  created_at: string;
  updated_at: string;
};

export type B2BMe = {
  user_id: string;
  memberships: B2BMembership[];
  organizations: B2BOrg[];
  onboarding_status_by_org: Record<string, string>;
  billing_status_by_org: Record<string, string>;
};

export type B2BFeed = {
  id: string;
  org_id: string;
  store_id: string;
  source_type: string;
  source_url: string;
  schedule_cron: string;
  status: string;
  is_active: boolean;
  last_validated_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type B2BFeedRun = {
  id: string;
  feed_id: string;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  total_items: number;
  processed_items: number;
  rejected_items: number;
  error_summary?: string | null;
};

export type B2BCampaign = {
  id: string;
  org_id: string;
  store_id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  strategy: string;
  daily_budget: number;
  monthly_budget: number;
  bid_default: number;
  bid_cap: number;
  pacing_mode: string;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type B2BAnalyticsOverview = {
  org_id: string;
  period_days: number;
  summary: Record<string, number | string | boolean | null>;
  series: Array<Record<string, number | string | boolean | null>>;
  generated_at: string;
};

export type B2BBillingPlan = {
  id: string;
  code: string;
  name: string;
  monthly_fee: number;
  included_clicks: number;
  click_price: number;
  currency: string;
  limits: Record<string, unknown>;
};

export type B2BInvoice = {
  id: string;
  org_id: string;
  invoice_number: string;
  status: "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "void";
  currency: string;
  total_amount: number;
  paid_amount: number;
  due_at?: string | null;
  issued_at?: string | null;
  paid_at?: string | null;
  created_at: string;
};

export type B2BAct = {
  id: string;
  org_id: string;
  invoice_id: string;
  act_number: string;
  status: string;
  document_url?: string | null;
  issued_at?: string | null;
  signed_at?: string | null;
  created_at: string;
};

export type B2BSupportTicket = {
  id: string;
  org_id: string;
  subject: string;
  category: string;
  priority: string;
  status: "open" | "in_progress" | "waiting_merchant" | "resolved" | "closed";
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type B2BPartnerLead = {
  id: string;
  status: "submitted" | "review" | "approved" | "rejected";
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
  country_code: string;
  city?: string | null;
  categories: string[];
  monthly_orders?: number | null;
  avg_order_value?: number | null;
  feed_url?: string | null;
  logistics_model: "own_warehouse" | "dropshipping" | "marketplace_fulfillment" | "hybrid";
  warehouses_count?: number | null;
  marketplaces: string[];
  returns_policy?: string | null;
  goals?: string | null;
  notes?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminB2BListResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminB2BOnboardingApplication = {
  id: string;
  org_id: string;
  status: "draft" | "submitted" | "review" | "approved" | "rejected";
  company_name: string;
  billing_email: string;
  contact_name: string;
  tax_id?: string | null;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminB2BDispute = {
  id: string;
  org_id: string;
  click_charge_id: string;
  status: "open" | "review" | "accepted" | "rejected";
  reason?: string | null;
  message?: string | null;
  resolution_note?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

export type AdminB2BRiskFlag = {
  id: string;
  level: "low" | "medium" | "high" | "critical";
  code: string;
  details: Record<string, unknown>;
  click_event_id: string;
  org_id?: string | null;
  created_at: string;
};

export type AdminB2BPartnerLead = B2BPartnerLead;
