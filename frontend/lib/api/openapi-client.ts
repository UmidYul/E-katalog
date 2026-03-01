import { apiClient } from "@/lib/api/client";
import type {
  BrandListItem,
  CompareMatrixResponse,
  CompareShareCreateResponse,
  CompareShareResolveResponse,
  FilterBucket,
  Paginated,
  PriceHistoryPoint,
  PriceAlertMeta,
  ProductAnswer,
  ProductDetail,
  ProductListItem,
  ProductOffer,
  ProductQuestion,
  ProductReview,
  SortOption
} from "@/types/domain";
import type {
  AdminAlertEvent,
  AdminAlertsAnalytics,
  AdminCategory,
  AdminCatalogQualityAnalytics,
  AdminFeedbackQueueResponse,
  AdminMetrics,
  AdminModerationAnalytics,
  AdminOrder,
  AdminOperationsAnalytics,
  AdminOverviewAnalytics,
  AdminProduct,
  AdminQualityNoOfferItem,
  AdminRevenueAnalytics,
  AdminScrapeSource,
  AdminSettings,
  AdminStore,
  AdminUser,
  AdminUsersAnalytics,
  AnalyticsGranularity,
  AnalyticsPeriod,
  AlertSource,
  AlertStatus,
  Severity,
} from "@/types/admin";
import type {
  AdminB2BDispute,
  AdminB2BListResponse,
  AdminB2BOnboardingApplication,
  AdminB2BPartnerLead,
  AdminB2BRiskFlag,
  B2BAct,
  B2BAnalyticsOverview,
  B2BCampaign,
  B2BFeed,
  B2BFeedRun,
  B2BInvoice,
  B2BBillingPlan,
  B2BMe,
  B2BPartnerLead,
  B2BPartnerLeadStatus,
  B2BSupportTicket,
} from "@/types/b2b";

export type CatalogQuery = {
  q?: string;
  category_id?: string;
  brand_id?: string[];
  store_id?: string[];
  seller_id?: string[];
  min_price?: number;
  max_price?: number;
  max_delivery_days?: number;
  in_stock?: boolean;
  sort?: SortOption;
  attrs?: Record<string, string[]>;
  limit?: number;
  cursor?: string;
};

export const catalogApi = {
  async search(query: CatalogQuery): Promise<Paginated<ProductListItem>> {
    const { attrs, ...rest } = query;
    const flatAttrs = attrs ? Object.entries(attrs).flatMap(([key, values]) => values.map((value) => `${key}:${value}`)) : undefined;
    const params = { ...rest, attr: flatAttrs };
    const { data } = await apiClient.get<Paginated<ProductListItem>>("/search", { params });
    return data;
  },
  async listProducts(query: CatalogQuery): Promise<Paginated<ProductListItem>> {
    const { attrs, ...rest } = query;
    const flatAttrs = attrs ? Object.entries(attrs).flatMap(([key, values]) => values.map((value) => `${key}:${value}`)) : undefined;
    const params = { ...rest, attr: flatAttrs };
    const { data } = await apiClient.get<Paginated<ProductListItem>>("/products", { params });
    return data;
  },
  async getProduct(productId: string): Promise<ProductDetail> {
    const { data } = await apiClient.get<ProductDetail>(`/products/${productId}`);
    return data;
  },
  async getOffers(
    productId: string,
    query?: { sort?: "best_value" | "price" | "seller_rating" | "delivery"; in_stock?: boolean; limit?: number },
  ): Promise<ProductOffer[]> {
    const { data } = await apiClient.get<ProductOffer[]>(`/products/${productId}/offers`, { params: query });
    return data;
  },
  async getProductPriceHistory(productId: string, days: number = 30): Promise<PriceHistoryPoint[]> {
    const { data } = await apiClient.get<PriceHistoryPoint[]>(`/products/${productId}/price-history`, {
      params: { days }
    });
    return data;
  },
  async getCategories(): Promise<Array<{ id: string; slug: string; name: string }>> {
    const { data } = await apiClient.get<Array<{ id: string; slug: string; name: string }>>("/categories");
    return data;
  },
  async getBrands(): Promise<BrandListItem[]> {
    const { data } = await apiClient.get<BrandListItem[]>("/brands");
    return data;
  },
  async getFilters(categoryId?: string): Promise<{ attributes?: FilterBucket[]; stores?: Array<{ id: string; name: string }>; sellers?: Array<{ id: string; name: string }> }> {
    const { data } = await apiClient.get<{ attributes?: FilterBucket[]; stores?: Array<{ id: string; name: string }>; sellers?: Array<{ id: string; name: string }> }>("/filters", {
      params: { category_id: categoryId }
    });
    return data;
  },
  async compareProducts(productIds: string[]): Promise<CompareMatrixResponse> {
    const { data } = await apiClient.post<CompareMatrixResponse>("/compare", {
      product_ids: productIds
    });
    return data;
  },
  async createCompareShare(productIds: string[], ttlDays: number = 30, telemetrySource?: string): Promise<CompareShareCreateResponse> {
    const { data } = await apiClient.post<CompareShareCreateResponse>("/compare/share", {
      product_ids: productIds,
      ttl_days: ttlDays,
      telemetry_source: telemetrySource
    });
    return data;
  },
  async resolveCompareShare(token: string): Promise<CompareShareResolveResponse> {
    const { data } = await apiClient.get<CompareShareResolveResponse>(`/compare/share/${token}`);
    return data;
  }
};

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  twofa_enabled?: boolean;
};

export type TwoFactorChallenge = {
  requires_2fa: true;
  challenge_token: string;
  expires_in: number;
};

export type LoginResponse = AuthUser | TwoFactorChallenge;

export type AuthSession = {
  id: string;
  device: string;
  ip_address: string;
  location: string;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
};

export type ChangePasswordPayload = {
  current_password: string;
  new_password: string;
  revoke_other_sessions?: boolean;
};

export type TwoFactorSetupResponse = {
  secret: string;
  qr_svg: string;
  recovery_codes: string[];
  otpauth_url: string;
};

export type TwoFactorVerifyPayload = {
  code?: string;
  recovery_code?: string;
  challenge_token?: string;
};

export type OAuthProviderInfo = {
  provider: string;
  enabled: boolean;
  authorization_endpoint: string;
};

export const authApi = {
  login: (payload: { email: string; password: string; two_factor_code?: string; recovery_code?: string }) =>
    apiClient.post<LoginResponse>("/auth/login", payload),
  register: (payload: { email: string; password: string; full_name: string }) => apiClient.post<AuthUser>("/auth/register", payload),
  logout: () => apiClient.post("/auth/logout"),
  me: () => apiClient.get<AuthUser>("/auth/me"),
  changePassword: (payload: ChangePasswordPayload) => apiClient.post<{ ok: boolean; revoked_sessions: number }>("/auth/change-password", payload),
  sessions: () => apiClient.get<AuthSession[]>("/auth/sessions"),
  revokeSession: (sessionId: string) => apiClient.delete<{ ok: boolean }>(`/auth/sessions/${sessionId}`),
  revokeOtherSessions: () => apiClient.delete<{ ok: boolean; revoked: number }>("/auth/sessions"),
  twoFactorSetup: () => apiClient.post<TwoFactorSetupResponse>("/auth/2fa/setup"),
  twoFactorVerify: (payload: TwoFactorVerifyPayload) => apiClient.post<AuthUser | { ok: boolean; enabled: boolean }>("/auth/2fa/verify", payload),
  twoFactorDisable: () => apiClient.delete<{ ok: boolean; enabled: boolean }>("/auth/2fa"),
  oauthProviders: () => apiClient.get<{ providers: OAuthProviderInfo[] }>("/auth/oauth/providers")
};

export type UserProfile = {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  phone: string;
  city: string;
  telegram: string;
  about: string;
  updated_at?: string | null;
};

export type UserProfilePatch = {
  display_name?: string;
  phone?: string;
  city?: string;
  telegram?: string;
  about?: string;
};

export type NotificationPreferences = {
  price_drop_alerts: boolean;
  stock_alerts: boolean;
  weekly_digest: boolean;
  marketing_emails: boolean;
  public_profile: boolean;
  compact_view: boolean;
  channels: {
    email: boolean;
    telegram: boolean;
  };
};

export type NotificationPreferencesPatch = {
  price_drop_alerts?: boolean;
  stock_alerts?: boolean;
  weekly_digest?: boolean;
  marketing_emails?: boolean;
  public_profile?: boolean;
  compact_view?: boolean;
  channels?: {
    email?: boolean;
    telegram?: boolean;
  };
};

export type RecentlyViewedItem = {
  id: string;
  slug: string;
  title: string;
  min_price?: number | null;
  viewed_at: string;
};

export type UserPriceAlert = PriceAlertMeta & {
  id: string;
  channel: "telegram" | "email" | string;
};

export const userApi = {
  favorites: () => apiClient.get<Array<{ product_id: string }>>("/users/favorites"),
  toggleFavorite: (productId: string) => apiClient.post(`/users/favorites/${productId}`),
  profile: () => apiClient.get<UserProfile>("/users/me/profile"),
  updateProfile: (payload: UserProfilePatch) => apiClient.patch<UserProfile>("/users/me/profile", payload),
  notificationPreferences: () => apiClient.get<NotificationPreferences>("/users/me/notification-preferences"),
  updateNotificationPreferences: (payload: NotificationPreferencesPatch) =>
    apiClient.patch<NotificationPreferences>("/users/me/notification-preferences", payload),
  priceAlerts: (query?: { channel?: "telegram" | "email"; active_only?: boolean; limit?: number; offset?: number }) =>
    apiClient.get<UserPriceAlert[]>("/users/me/alerts", { params: query }),
  upsertPriceAlert: (
    productId: string,
    payload: {
      alerts_enabled?: boolean;
      target_price?: number | null;
      baseline_price?: number | null;
      current_price?: number | null;
      channel?: "telegram" | "email";
    },
  ) => apiClient.post<UserPriceAlert>(`/products/${productId}/alerts`, payload),
  deletePriceAlert: (alertId: string) => apiClient.delete<{ ok: boolean }>(`/users/me/alerts/${alertId}`),
  recentlyViewed: () => apiClient.get<RecentlyViewedItem[]>("/users/me/recently-viewed"),
  pushRecentlyViewed: (productId: string) => apiClient.post<RecentlyViewedItem>("/users/me/recently-viewed", { product_id: productId }),
  clearRecentlyViewed: () => apiClient.delete<{ ok: boolean }>("/users/me/recently-viewed")
};

export const productFeedbackApi = {
  listReviews: async (productId: string, query?: { limit?: number; offset?: number }): Promise<ProductReview[]> => {
    const { data } = await apiClient.get<ProductReview[]>(`/products/${productId}/reviews`, { params: query });
    return data;
  },
  createReview: async (
    productId: string,
    payload: { author: string; rating: number; comment: string; pros?: string; cons?: string }
  ): Promise<ProductReview> => {
    const { data } = await apiClient.post<ProductReview>(`/products/${productId}/reviews`, payload);
    return data;
  },
  listQuestions: async (productId: string, query?: { limit?: number; offset?: number }): Promise<ProductQuestion[]> => {
    const { data } = await apiClient.get<ProductQuestion[]>(`/products/${productId}/questions`, { params: query });
    return data;
  },
  createQuestion: async (
    productId: string,
    payload: { author: string; question: string }
  ): Promise<ProductQuestion> => {
    const { data } = await apiClient.post<ProductQuestion>(`/products/${productId}/questions`, payload);
    return data;
  },
  createAnswer: async (
    questionId: string,
    payload: { author?: string; text: string; is_official?: boolean }
  ): Promise<ProductAnswer> => {
    const { data } = await apiClient.post<ProductAnswer>(`/products/questions/${questionId}/answers`, payload);
    return data;
  },
  voteReview: async (reviewId: string, payload: { helpful: boolean }) => {
    const { data } = await apiClient.post<{
      ok: boolean;
      review_id: string;
      helpful_votes: number;
      not_helpful_votes: number;
      user_vote: "helpful" | "not_helpful";
    }>(`/products/reviews/${reviewId}/votes`, payload);
    return data;
  },
  reportReview: async (reviewId: string, payload: { reason: string }) => {
    const { data } = await apiClient.post<{
      ok: boolean;
      target_id: string;
      kind: "review";
      reports_total: number;
      created_at: string;
    }>(`/products/reviews/${reviewId}/report`, payload);
    return data;
  },
  reportQuestion: async (questionId: string, payload: { reason: string }) => {
    const { data } = await apiClient.post<{
      ok: boolean;
      target_id: string;
      kind: "question";
      reports_total: number;
      created_at: string;
    }>(`/products/questions/${questionId}/report`, payload);
    return data;
  },
  pinAnswer: async (answerId: string, payload: { pinned: boolean }) => {
    const { data } = await apiClient.post<{
      ok: boolean;
      answer_id: string;
      pinned: boolean;
      pinned_at?: string | null;
      pinned_by?: string | null;
    }>(`/products/answers/${answerId}/pin`, payload);
    return data;
  },
  moderateReview: async (reviewId: string, payload: { status: "published" | "pending" | "rejected" }) => {
    const { data } = await apiClient.post<{ ok: boolean; status: string }>(`/products/reviews/${reviewId}/moderation`, payload);
    return data;
  },
  moderateQuestion: async (questionId: string, payload: { status: "published" | "pending" | "rejected" }) => {
    const { data } = await apiClient.post<{ ok: boolean; status: string }>(`/products/questions/${questionId}/moderation`, payload);
    return data;
  }
};

export type AdminListQuery = {
  q?: string;
  page?: number;
  limit?: number;
  sort?: string;
};

export type AdminImportProductsResponse = {
  ok: boolean;
  source: "csv" | "json";
  received_rows: number;
  imported_rows: number;
  skipped_rows: number;
  task_id: string;
  errors?: string[];
};

export const adminApi = {
  users: (query: AdminListQuery) => apiClient.get<Paginated<AdminUser>>("/admin/users", { params: query }),
  userById: (id: string) => apiClient.get<AdminUser>(`/admin/users/${id}`),
  updateUser: (id: string, payload: Partial<AdminUser>) => apiClient.patch<AdminUser>(`/admin/users/${id}`, payload),
  deleteUser: (id: string) => apiClient.delete<{ ok: boolean }>(`/admin/users/${id}`),

  products: (query: AdminListQuery) =>
    apiClient.get<Paginated<AdminProduct>>("/products", {
      params: {
        q: query.q || undefined,
        limit: query.limit ?? 20,
        sort: query.sort && ["relevance", "price_asc", "price_desc", "popular", "newest"].includes(query.sort) ? query.sort : "popular",
      },
    }),
  productById: (id: string) => apiClient.get<ProductDetail>(`/products/${id}`),
  updateProduct: (id: string, payload: Record<string, unknown>) => apiClient.patch(`/admin/products/${id}`, payload),
  deleteProduct: (id: string) => apiClient.delete<{ ok: boolean }>(`/admin/products/${id}`),
  bulkDeleteProducts: (productIds: string[]) =>
    apiClient.post<{ ok: boolean; requested: number; deleted: number }>("/admin/products/bulk-delete", { product_ids: productIds }),
  bulkImportProducts: (payload: { source: "csv" | "json"; content: string; store_id?: string | null }) =>
    apiClient.post<AdminImportProductsResponse>("/admin/products/import", payload),
  bulkExportProducts: (format: "csv" | "json") =>
    apiClient.get<Blob>("/admin/products/export", { params: { format }, responseType: "blob" }),

  categories: () => apiClient.get<AdminCategory[]>("/categories"),
  createCategory: (payload: { name: string; slug: string; parent_id?: string | null }) => apiClient.post<AdminCategory>("/admin/categories", payload),
  updateCategory: (id: string, payload: Partial<AdminCategory>) => apiClient.patch<AdminCategory>(`/admin/categories/${id}`, payload),
  deleteCategory: (id: string) => apiClient.delete<{ ok: boolean }>(`/admin/categories/${id}`),

  orders: (query: AdminListQuery & { status?: string }) => apiClient.get<Paginated<AdminOrder>>("/admin/orders", { params: query }),
  orderById: (id: string) => apiClient.get<AdminOrder>(`/admin/orders/${id}`),
  updateOrderStatus: (id: string, status: AdminOrder["status"]) => apiClient.patch<AdminOrder>(`/admin/orders/${id}`, { status }),

  analytics: (period: "7d" | "30d" | "90d" | "365d" = "30d") => apiClient.get<AdminMetrics>("/admin/analytics", { params: { period } }),
  analyticsOverview: (period: AnalyticsPeriod = "30d") =>
    apiClient.get<AdminOverviewAnalytics>("/admin/analytics/overview", { params: { period } }),
  analyticsRevenue: (period: AnalyticsPeriod = "30d", granularity: AnalyticsGranularity = "day") =>
    apiClient.get<AdminRevenueAnalytics>("/admin/analytics/revenue", { params: { period, granularity } }),
  analyticsCatalogQuality: (period: AnalyticsPeriod = "30d") =>
    apiClient.get<AdminCatalogQualityAnalytics>("/admin/analytics/catalog-quality", { params: { period } }),
  analyticsOperations: (period: AnalyticsPeriod = "30d") =>
    apiClient.get<AdminOperationsAnalytics>("/admin/analytics/operations", { params: { period } }),
  analyticsModeration: (period: AnalyticsPeriod = "30d") =>
    apiClient.get<AdminModerationAnalytics>("/admin/analytics/moderation", { params: { period } }),
  analyticsUsers: (period: AnalyticsPeriod = "30d") =>
    apiClient.get<AdminUsersAnalytics>("/admin/analytics/users", { params: { period } }),
  analyticsAlerts: (query: {
    status?: AlertStatus;
    severity?: Severity;
    source?: AlertSource;
    code?: string;
    limit?: number;
    offset?: number;
    refresh?: boolean;
  }) => apiClient.get<AdminAlertsAnalytics>("/admin/analytics/alerts", { params: query }),
  ackAnalyticsAlert: (id: string) => apiClient.patch<AdminAlertEvent>(`/admin/analytics/alerts/${id}/ack`),
  resolveAnalyticsAlert: (id: string) => apiClient.patch<AdminAlertEvent>(`/admin/analytics/alerts/${id}/resolve`),
  runAnalyticsAlertEvaluation: () => apiClient.post<{ task_id: string; queued: string }>("/admin/analytics/alerts/evaluate"),
  feedbackQueue: (query: { status?: "all" | "published" | "pending" | "rejected"; kind?: "all" | "review" | "question"; limit?: number; offset?: number }) =>
    apiClient.get<AdminFeedbackQueueResponse>("/products/moderation/queue", { params: query }),
  moderateReview: (reviewId: string, payload: { status: "published" | "pending" | "rejected" }) =>
    apiClient.post<{ ok: boolean; status: string }>(`/products/reviews/${reviewId}/moderation`, payload),
  moderateQuestion: (questionId: string, payload: { status: "published" | "pending" | "rejected" }) =>
    apiClient.post<{ ok: boolean; status: string }>(`/products/questions/${questionId}/moderation`, payload),
  settings: () => apiClient.get<AdminSettings>("/admin/settings"),
  updateSettings: (payload: Partial<AdminSettings>) => apiClient.patch<AdminSettings>("/admin/settings", payload),

  stores: (query: AdminListQuery & { active_only?: boolean }) => apiClient.get<Paginated<AdminStore>>("/admin/stores", { params: query }),
  createStore: (payload: {
    name: string;
    slug?: string;
    provider?: string;
    base_url?: string | null;
    country_code?: string;
    trust_score?: number;
    crawl_priority?: number;
    is_active?: boolean;
  }) => apiClient.post<AdminStore>("/admin/stores", payload),
  updateStore: (id: string, payload: Partial<AdminStore>) => apiClient.patch<AdminStore>(`/admin/stores/${id}`, payload),
  deleteStore: (id: string) => apiClient.delete<{ ok: boolean }>(`/admin/stores/${id}`),
  storeSources: (storeId: string, query: AdminListQuery = {}) =>
    apiClient.get<Paginated<AdminScrapeSource>>(`/admin/stores/${storeId}/sources`, { params: query }),
  createStoreSource: (
    storeId: string,
    payload: { url: string; source_type?: string; priority?: number; is_active?: boolean },
  ) => apiClient.post<AdminScrapeSource>(`/admin/stores/${storeId}/sources`, payload),
  updateStoreSource: (storeId: string, sourceId: string, payload: Partial<AdminScrapeSource>) =>
    apiClient.patch<AdminScrapeSource>(`/admin/stores/${storeId}/sources/${sourceId}`, payload),
  deleteStoreSource: (storeId: string, sourceId: string) =>
    apiClient.delete<{ ok: boolean }>(`/admin/stores/${storeId}/sources/${sourceId}`),

  runReindex: () => apiClient.post<{ task_id: string; queued: string }>("/admin/reindex/products"),
  runEmbeddingRebuild: () => apiClient.post<{ task_id: string; queued: string }>("/admin/embeddings/rebuild"),
  runDedupe: () => apiClient.post<{ task_id: string; queued: string }>("/admin/dedupe/run"),
  runScrape: () => apiClient.post<{ task_id: string; queued: string }>("/admin/scrape/run"),
  runCatalogRebuild: () => apiClient.post<{ task_id: string; queued: string }>("/admin/catalog/rebuild"),
  runQualityReport: () => apiClient.post<{ task_id: string; queued: string }>("/admin/quality/reports/run"),
  runQualityAlertTest: () => apiClient.post<{ task_id: string; queued: string }>("/admin/quality/alerts/test"),
  qualityProductsWithoutValidOffers: (query: { limit?: number; offset?: number; active_only?: boolean } = {}) =>
    apiClient.get<{
      items: AdminQualityNoOfferItem[];
      total: number;
      limit: number;
      offset: number;
      request_id: string;
    }>("/admin/quality/products/without-valid-offers", { params: query }),
  deactivateQualityProductsWithoutValidOffers: (payload: { product_ids: string[] }) =>
    apiClient.post<{ ok: boolean; requested: number; deactivated: number; skipped: number }>(
      "/admin/quality/products/without-valid-offers/deactivate",
      payload,
    ),
  taskStatus: (taskId: string) =>
    apiClient.get<{ task_id: string; state: string; ready: boolean; successful: boolean; progress: number; info?: Record<string, unknown> }>(
      `/admin/tasks/${taskId}`,
    ),
};

export const b2bApi = {
  me: () => apiClient.get<B2BMe>("/b2b/me"),
  createOrg: (payload: {
    name: string;
    slug: string;
    legal_name?: string | null;
    tax_id?: string | null;
    website_url?: string | null;
  }) => apiClient.post<{ organization: B2BMe["organizations"][number]; membership: B2BMe["memberships"][number] }>("/b2b/orgs", payload),
  inviteMember: (orgId: string, payload: { email: string; role: string; expires_in_days?: number }) =>
    apiClient.post(`/b2b/orgs/${orgId}/invites`, payload),
  patchMember: (orgId: string, memberId: string, payload: { role?: string; status?: string }) =>
    apiClient.patch(`/b2b/orgs/${orgId}/members/${memberId}`, payload),

  submitOnboarding: (payload: {
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
  }) => apiClient.post("/b2b/onboarding/applications", payload),
  uploadOnboardingDocument: (payload: {
    org_id: string;
    application_id?: string | null;
    document_type: string;
    storage_url: string;
    checksum?: string | null;
  }) => apiClient.post("/b2b/onboarding/documents", payload),
  acceptContract: (payload: { org_id: string; contract_version: string }) => apiClient.post("/b2b/onboarding/accept-offer", payload),

  feeds: (query: { org_id?: string; store_id?: string } = {}) => apiClient.get<B2BFeed[]>("/b2b/feeds", { params: query }),
  createFeed: (payload: {
    org_id: string;
    store_id: string;
    source_type?: string;
    source_url: string;
    schedule_cron?: string;
    auth_config?: Record<string, unknown>;
    is_active?: boolean;
  }) => apiClient.post<B2BFeed>("/b2b/feeds", payload),
  validateFeed: (feedId: string, orgId?: string) =>
    apiClient.post<{ feed_id: string; run_id: string; status: string; quality_snapshot: Record<string, number> }>(
      `/b2b/feeds/${feedId}/validate`,
      {},
      { params: { org_id: orgId } },
    ),
  feedRuns: (feedId: string, orgId?: string) => apiClient.get<B2BFeedRun[]>(`/b2b/feeds/${feedId}/runs`, { params: { org_id: orgId } }),

  campaigns: (query: { org_id?: string } = {}) => apiClient.get<B2BCampaign[]>("/b2b/campaigns", { params: query }),
  createCampaign: (payload: {
    org_id: string;
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
  }) => apiClient.post<B2BCampaign>("/b2b/campaigns", payload),
  patchCampaign: (campaignId: string, payload: Partial<{
    status: "draft" | "active" | "paused" | "archived";
    daily_budget: number;
    monthly_budget: number;
    bid_default: number;
    bid_cap: number;
    pacing_mode: "even" | "aggressive";
    ends_at: string | null;
  }>, orgId?: string) => apiClient.patch<B2BCampaign>(`/b2b/campaigns/${campaignId}`, payload, { params: { org_id: orgId } }),

  analyticsOverview: (query: { org_id?: string; period_days?: number } = {}) =>
    apiClient.get<B2BAnalyticsOverview>("/b2b/analytics/overview", { params: query }),
  analyticsOffers: (query: { org_id?: string; limit?: number } = {}) =>
    apiClient.get<Array<{ offer_id: string; clicks: number; billable_clicks: number; spend: number }>>("/b2b/analytics/offers", { params: query }),
  analyticsAttribution: (query: { org_id?: string; period_days?: number } = {}) =>
    apiClient.get<Array<{ source_page: string; placement: string; clicks: number; billable_clicks: number; spend: number }>>(
      "/b2b/analytics/attribution",
      { params: query },
    ),

  billingPlans: () => apiClient.get<B2BBillingPlan[]>("/b2b/billing/plans"),
  subscribe: (payload: { org_id: string; plan_code: string }) =>
    apiClient.post<{ id: string; org_id: string; plan_id: string; status: string; starts_at: string; renews_at?: string | null; created_at: string }>(
      "/b2b/billing/subscriptions",
      payload,
    ),
  invoices: (query: { org_id?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<B2BInvoice[]>("/b2b/billing/invoices", { params: query }),
  payInvoice: (invoiceId: string, payload: { provider?: string; amount?: number }, orgId?: string) =>
    apiClient.post<{ invoice_id: string; payment_id: string; status: string; redirect_url?: string | null }>(
      `/b2b/billing/invoices/${invoiceId}/pay`,
      payload,
      { params: { org_id: orgId } },
    ),
  acts: (query: { org_id?: string } = {}) => apiClient.get<B2BAct[]>("/b2b/billing/acts", { params: query }),

  tickets: (query: { org_id?: string; status?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<B2BSupportTicket[]>("/b2b/support/tickets", { params: query }),
  createTicket: (payload: { org_id: string; subject: string; category?: string; priority?: string; body: string }) =>
    apiClient.post<B2BSupportTicket>("/b2b/support/tickets", payload),
  createPartnerLead: (payload: {
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
  }) => apiClient.post<B2BPartnerLead>("/b2b/partners/leads", payload),
  partnerLeadStatus: (leadId: string, token: string) =>
    apiClient.get<B2BPartnerLeadStatus>(`/b2b/partners/leads/${leadId}/status`, { params: { token } }),
};

export const adminB2bApi = {
  onboardingApplications: (query: { status?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<AdminB2BListResponse<AdminB2BOnboardingApplication>>("/admin/b2b/onboarding/applications", {
      params: query,
    }),
  patchOnboardingApplication: (applicationId: string, payload: { status: string; rejection_reason?: string | null }) =>
    apiClient.patch(`/admin/b2b/onboarding/applications/${applicationId}`, payload),
  disputes: (query: { status?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<AdminB2BListResponse<AdminB2BDispute>>("/admin/b2b/disputes", { params: query }),
  patchDispute: (disputeId: string, payload: { status: string; resolution_note?: string | null }) =>
    apiClient.patch(`/admin/b2b/disputes/${disputeId}`, payload),
  riskFlags: (query: { level?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<AdminB2BListResponse<AdminB2BRiskFlag>>("/admin/b2b/risk-flags", { params: query }),
  partnerLeads: (query: { status?: string; q?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<AdminB2BListResponse<AdminB2BPartnerLead>>("/admin/b2b/partner-leads", { params: query }),
  patchPartnerLead: (leadId: string, payload: { status: string; review_note?: string | null }) =>
    apiClient.patch(`/admin/b2b/partner-leads/${leadId}`, payload),
  plans: () => apiClient.get<B2BBillingPlan[]>("/admin/b2b/plans"),
  upsertPlan: (payload: {
    code: string;
    name: string;
    monthly_fee: number;
    included_clicks: number;
    click_price: number;
    limits?: Record<string, unknown>;
  }) => apiClient.post<B2BBillingPlan>("/admin/b2b/plans/upsert", payload),
  runInvoicesJob: () => apiClient.post<{ task_id: string; queued: string }>("/admin/b2b/tasks/invoices"),
  runActsJob: () => apiClient.post<{ task_id: string; queued: string }>("/admin/b2b/tasks/acts"),
  runFraudScanJob: () => apiClient.post<{ task_id: string; queued: string }>("/admin/b2b/tasks/fraud-scan"),
  runFeedHealthJob: () => apiClient.post<{ task_id: string; queued: string }>("/admin/b2b/tasks/feed-health"),
};

export type AdminSellerApplication = {
  id: string;
  status: "pending" | "review" | "approved" | "rejected" | string;
  company_name: string;
  contact_name?: string | null;
  email: string;
  phone: string;
  country_code?: string;
  city?: string | null;
  categories?: string[];
  is_duplicate_email?: boolean;
  is_duplicate_company?: boolean;
  review_note?: string | null;
  provisioning_status?: string | null;
  submitted_at?: string;
  reviewed_at?: string | null;
  age_hours?: number;
  priority?: "normal" | "high" | "critical" | "resolved" | string;
  created_at: string;
  updated_at: string;
};

export type AdminSellerApplicationsSummary = {
  total: number;
  status_counts: {
    pending: number;
    review: number;
    approved: number;
    rejected: number;
  };
  created_last_7d: number;
  duplicates_count: number;
  avg_review_hours: number;
  median_open_hours: number;
  oldest_open_hours: number;
};

export type AdminSellerApplicationHistoryEvent = {
  id: string;
  action: string;
  actor_user_id?: string | null;
  actor_role?: string | null;
  status_from?: "pending" | "review" | "approved" | "rejected" | string | null;
  status_to?: "pending" | "review" | "approved" | "rejected" | string | null;
  review_note?: string | null;
  notification_sent?: boolean | null;
  notification_error?: string | null;
  source?: string | null;
  created_at: string;
};

export type BulkSellerApplicationActionIn = {
  application_ids: string[];
  status: "pending" | "review" | "approved" | "rejected";
  review_note?: string | null;
};

export type AdminSellerShop = {
  uuid: string;
  org_uuid: string;
  owner_user_uuid: string;
  slug: string;
  shop_name: string;
  status: string;
  website_url?: string | null;
  contact_email: string;
  contact_phone: string;
  is_auto_paused?: boolean;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const adminSellersApi = {
  applications: (
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
  ) =>
    apiClient.get<{ items: AdminSellerApplication[]; total: number; limit: number; offset: number }>("/admin/sellers/applications", { params: query }),
  applicationsSummary: (query: { status?: string; q?: string; country_code?: string; created_from?: string; created_to?: string } = {}) =>
    apiClient.get<AdminSellerApplicationsSummary>("/admin/sellers/applications/summary", { params: query }),
  applicationById: (applicationId: string) => apiClient.get<AdminSellerApplication>(`/admin/sellers/applications/${applicationId}`),
  applicationHistory: (applicationId: string, query: { limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: AdminSellerApplicationHistoryEvent[]; total: number; limit: number; offset: number }>(
      `/admin/sellers/applications/${applicationId}/history`,
      { params: query },
    ),
  patchApplicationStatus: (applicationId: string, payload: { status: string; review_note?: string | null }) =>
    apiClient.patch(`/admin/sellers/applications/${applicationId}/status`, payload),
  bulkPatchApplicationStatus: (payload: BulkSellerApplicationActionIn) =>
    apiClient.post<{
      ok: boolean;
      status: string;
      processed: number;
      updated_count: number;
      not_found_count: number;
      failed_count: number;
      items: AdminSellerApplication[];
      not_found_ids: string[];
      failed: Array<{ application_id: string; detail: string; status_code: number }>;
    }>("/admin/sellers/applications/bulk-status", payload),
  shops: (query: { limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: AdminSellerShop[]; total: number; limit: number; offset: number }>("/admin/sellers/shops", { params: query }),
  productModeration: (query: { status?: string; q?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: Array<{ uuid: string; title: string; status: string; price: number; stock_quantity: number; sku?: string | null; moderation_comment?: string | null; updated_at: string; shop_uuid: string; shop_name: string }>; total: number; limit: number; offset: number }>(
      "/admin/sellers/product-moderation",
      { params: query },
    ),
  productModerationStatusHistory: (productId: string, query: { limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: SellerProductStatusEvent[]; total: number; limit: number; offset: number }>(`/admin/sellers/product-moderation/${productId}/status-history`, {
      params: query,
    }),
  patchProductModerationStatus: (productId: string, payload: { status: string; moderation_comment?: string | null }) =>
    apiClient.patch(`/admin/sellers/product-moderation/${productId}/status`, payload),
  finance: (query: { limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: Array<{ shop_uuid: string; shop_name: string; shop_status: string; balance: number; credit_limit: number; total_topup: number; total_spend: number }>; total: number; limit: number; offset: number }>(
      "/admin/sellers/finance",
      { params: query },
    ),
  tariffs: () =>
    apiClient.get<{ items: Array<{ uuid: string; code: string; name: string; monthly_fee: number; included_clicks: number; click_price: number; currency: string; is_active: boolean; updated_at: string }>; total: number }>(
      "/admin/sellers/tariffs",
    ),
  tariffAssignments: (query: { limit?: number } = {}) =>
    apiClient.get<{ items: Array<{ shop_uuid: string; shop_name: string; subscription_status?: string | null; assigned_at?: string | null; plan_code?: string | null; plan_name?: string | null }>; total: number }>(
      "/admin/sellers/tariffs/assignments",
      { params: query },
    ),
  assignTariff: (shopId: string, payload: { plan_code: string }) =>
    apiClient.put(`/admin/sellers/tariffs/assignments/${shopId}`, payload),
};

export type SellerShop = {
  id: string;
  org_id: string;
  owner_user_id: string;
  slug: string;
  shop_name: string;
  status: string;
  website_url?: string | null;
  contact_email: string;
  contact_phone: string;
  is_auto_paused: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SellerShopPatch = {
  shop_name?: string;
  website_url?: string | null;
  contact_email?: string;
  contact_phone?: string;
  logo_url?: string | null;
  banner_url?: string | null;
  brand_color?: string | null;
};

export type SellerProductStatus = "draft" | "pending_moderation" | "active" | "rejected" | "archived";
export type SellerApplicationStatus = "pending" | "review" | "approved" | "rejected";

export type SellerApplicationCreateIn = {
  shop_name: string;
  contact_person: string;
  legal_type: "individual" | "llc" | "other";
  inn: string;
  legal_address: string;
  actual_address?: string | null;
  contact_phone: string;
  contact_email: string;
  accepts_terms: boolean;
  has_website?: boolean;
  website_url?: string | null;
  work_type?: "online" | "offline" | "both";
  delivery_available?: boolean;
  pickup_available?: boolean;
  product_categories?: string[];
  documents?: Array<Record<string, unknown>>;
};

export type SellerApplication = {
  id: string;
  status: SellerApplicationStatus;
  shop_name: string;
  contact_email: string;
  contact_phone: string;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
};

export type SellerApplicationStatusLookup = {
  id: string;
  status: SellerApplicationStatus;
  review_note?: string | null;
  provisioning_status: string;
  seller_login_url?: string | null;
  seller_panel_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type SellerProduct = {
  id: string;
  shop_id: string;
  source: string;
  title: string;
  description?: string | null;
  category_id?: string | null;
  images: Array<Record<string, unknown>>;
  price: number;
  old_price?: number | null;
  sku?: string | null;
  barcode?: string | null;
  status: SellerProductStatus;
  moderation_comment?: string | null;
  track_inventory: boolean;
  stock_quantity: number;
  stock_reserved: number;
  stock_alert_threshold?: number | null;
  attributes: Record<string, unknown>;
  views_count: number;
  clicks_count: number;
  created_at: string;
  updated_at: string;
};

export type SellerProductCreateIn = {
  title: string;
  description?: string | null;
  category_id?: string | null;
  images?: Array<Record<string, unknown>>;
  price: number;
  old_price?: number | null;
  sku?: string | null;
  barcode?: string | null;
  track_inventory?: boolean;
  stock_quantity?: number;
  stock_alert_threshold?: number | null;
  attributes?: Record<string, unknown>;
  publish?: boolean;
};

export type SellerProductPatchIn = {
  title?: string;
  description?: string | null;
  category_id?: string | null;
  images?: Array<Record<string, unknown>>;
  price?: number;
  old_price?: number | null;
  sku?: string | null;
  barcode?: string | null;
  status?: "draft" | "pending_moderation" | "archived";
  track_inventory?: boolean;
  stock_alert_threshold?: number | null;
  attributes?: Record<string, unknown>;
};

export type SellerInventoryLog = {
  id: number;
  product_id: string;
  action: string;
  quantity_before: number;
  quantity_after: number;
  delta: number;
  reference_id?: string | null;
  comment?: string | null;
  created_by_user_id?: string | null;
  created_at: string;
};

export type SellerProductStatusEvent = {
  id: string;
  product_id: string;
  from_status?: SellerProductStatus | null;
  to_status: SellerProductStatus;
  event_type: string;
  reason_code?: string | null;
  reason_label: string;
  comment?: string | null;
  actor_role: "seller" | "admin" | "system";
  actor_user_id?: string | null;
  actor_label: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export const sellerApi = {
  createApplication: (payload: SellerApplicationCreateIn) => apiClient.post<SellerApplication>("/applications/seller", payload),
  applicationStatus: (query: { email: string; phone: string }) =>
    apiClient.get<SellerApplicationStatusLookup>("/applications/seller/status", { params: query }),
  shop: () => apiClient.get<SellerShop>("/seller/shop"),
  updateShop: (payload: SellerShopPatch) => apiClient.put<SellerShop>("/seller/shop", payload),
  products: (query: { status?: string; q?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<SellerProduct[]>("/seller/products/", { params: query }),
  productById: (productId: string) => apiClient.get<SellerProduct>(`/seller/products/${productId}`),
  createProduct: (payload: SellerProductCreateIn) => apiClient.post<SellerProduct>("/seller/products/", payload),
  updateProduct: (productId: string, payload: SellerProductPatchIn) => apiClient.put<SellerProduct>(`/seller/products/${productId}`, payload),
  archiveProduct: (productId: string) => apiClient.delete<{ ok: boolean; id: string }>(`/seller/products/${productId}`),
  patchProductStock: (productId: string, payload: { quantity: number; comment?: string | null }) =>
    apiClient.patch<{ ok: boolean; quantity: number; delta: number }>(`/seller/products/${productId}/stock`, payload),
  productInventoryLog: (productId: string, query: { limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: SellerInventoryLog[]; total: number; limit: number; offset: number }>(`/seller/products/${productId}/inventory-log`, { params: query }),
  productStatusHistory: (productId: string, query: { limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: SellerProductStatusEvent[]; total: number; limit: number; offset: number }>(`/seller/products/${productId}/status-history`, { params: query }),
};

