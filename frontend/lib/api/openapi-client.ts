import { apiClient } from "@/lib/api/client";
import type {
  BrandListItem,
  CompareMatrixResponse,
  FilterBucket,
  Paginated,
  PriceHistoryPoint,
  ProductAnswer,
  ProductDetail,
  ProductListItem,
  ProductOffer,
  ProductQuestion,
  ProductReview,
  SortOption
} from "@/types/domain";
import type {
  AdminCategory,
  AdminFeedbackQueueResponse,
  AdminMetrics,
  AdminOrder,
  AdminProduct,
  AdminQualityNoOfferItem,
  AdminScrapeSource,
  AdminSettings,
  AdminStore,
  AdminUser,
} from "@/types/admin";

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
  async getOffers(productId: string): Promise<ProductOffer[]> {
    const { data } = await apiClient.get<ProductOffer[]>(`/products/${productId}/offers`);
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
  }
};

export const authApi = {
  login: (payload: { email: string; password: string }) => apiClient.post("/auth/login", payload),
  register: (payload: { email: string; password: string; full_name: string }) => apiClient.post("/auth/register", payload),
  logout: () => apiClient.post("/auth/logout"),
  me: () => apiClient.get<{ id: string; email: string; full_name: string; role: string }>("/auth/me")
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

export const userApi = {
  favorites: () => apiClient.get<Array<{ product_id: string }>>("/users/favorites"),
  toggleFavorite: (productId: string) => apiClient.post(`/users/favorites/${productId}`),
  profile: () => apiClient.get<UserProfile>("/users/me/profile"),
  updateProfile: (payload: UserProfilePatch) => apiClient.patch<UserProfile>("/users/me/profile", payload)
};

export const productFeedbackApi = {
  listReviews: async (productId: string): Promise<ProductReview[]> => {
    const { data } = await apiClient.get<ProductReview[]>(`/products/${productId}/reviews`);
    return data;
  },
  createReview: async (
    productId: string,
    payload: { author: string; rating: number; comment: string; pros?: string; cons?: string }
  ): Promise<ProductReview> => {
    const { data } = await apiClient.post<ProductReview>(`/products/${productId}/reviews`, payload);
    return data;
  },
  listQuestions: async (productId: string): Promise<ProductQuestion[]> => {
    const { data } = await apiClient.get<ProductQuestion[]>(`/products/${productId}/questions`);
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

