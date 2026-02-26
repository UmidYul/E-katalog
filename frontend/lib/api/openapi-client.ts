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
  B2BAct,
  B2BAnalyticsOverview,
  B2BCampaign,
  B2BFeed,
  B2BFeedRun,
  B2BInvoice,
  B2BBillingPlan,
  B2BMe,
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
};

export const adminB2bApi = {
  onboardingApplications: (query: { status?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }>("/admin/b2b/onboarding/applications", {
      params: query,
    }),
  patchOnboardingApplication: (applicationId: string, payload: { status: string; rejection_reason?: string | null }) =>
    apiClient.patch(`/admin/b2b/onboarding/applications/${applicationId}`, payload),
  disputes: (query: { status?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }>("/admin/b2b/disputes", { params: query }),
  patchDispute: (disputeId: string, payload: { status: string; resolution_note?: string | null }) =>
    apiClient.patch(`/admin/b2b/disputes/${disputeId}`, payload),
  riskFlags: (query: { level?: string; limit?: number; offset?: number } = {}) =>
    apiClient.get<{ items: Array<Record<string, unknown>>; total: number; limit: number; offset: number }>("/admin/b2b/risk-flags", { params: query }),
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

