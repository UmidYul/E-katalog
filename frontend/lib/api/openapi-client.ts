import { apiClient } from "@/lib/api/client";
import type { FilterBucket, Paginated, ProductDetail, ProductListItem, ProductOffer, SortOption } from "@/types/domain";
import type {
  AdminCategory,
  AdminMetrics,
  AdminOrder,
  AdminProduct,
  AdminScrapeSource,
  AdminSettings,
  AdminStore,
  AdminUser,
} from "@/types/admin";

export type CatalogQuery = {
  q?: string;
  category_id?: number;
  brand_id?: number[];
  store_id?: number[];
  seller_id?: number[];
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
  async getProduct(productId: number): Promise<ProductDetail> {
    const { data } = await apiClient.get<ProductDetail>(`/products/${productId}`);
    return data;
  },
  async getOffers(productId: number): Promise<ProductOffer[]> {
    const { data } = await apiClient.get<ProductOffer[]>(`/products/${productId}/offers`);
    return data;
  },
  async getCategories(): Promise<Array<{ id: number; slug: string; name: string }>> {
    const { data } = await apiClient.get<Array<{ id: number; slug: string; name: string }>>("/categories");
    return data;
  },
  async getBrands(): Promise<Array<{ id: number; name: string }>> {
    const { data } = await apiClient.get<Array<{ id: number; name: string }>>("/brands");
    return data;
  },
  async getFilters(categoryId?: number): Promise<{ attributes?: FilterBucket[]; stores?: Array<{ id: number; name: string }>; sellers?: Array<{ id: number; name: string }> }> {
    const { data } = await apiClient.get<{ attributes?: FilterBucket[]; stores?: Array<{ id: number; name: string }>; sellers?: Array<{ id: number; name: string }> }>("/filters", {
      params: { category_id: categoryId }
    });
    return data;
  }
};

export const authApi = {
  login: (payload: { email: string; password: string }) => apiClient.post("/auth/login", payload),
  register: (payload: { email: string; password: string; full_name: string }) => apiClient.post("/auth/register", payload),
  logout: () => apiClient.post("/auth/logout"),
  me: () => apiClient.get<{ id: number; email: string; full_name: string }>("/auth/me")
};

export const userApi = {
  favorites: () => apiClient.get<Array<{ product_id: number }>>("/users/favorites"),
  toggleFavorite: (productId: number) => apiClient.post(`/users/favorites/${productId}`)
};

export type AdminListQuery = {
  q?: string;
  page?: number;
  limit?: number;
  sort?: string;
};

export const adminApi = {
  users: (query: AdminListQuery) => apiClient.get<Paginated<AdminUser>>("/admin/users", { params: query }),
  userById: (id: number) => apiClient.get<AdminUser>(`/admin/users/${id}`),
  updateUser: (id: number, payload: Partial<AdminUser>) => apiClient.patch<AdminUser>(`/admin/users/${id}`, payload),
  deleteUser: (id: number) => apiClient.delete<{ ok: boolean }>(`/admin/users/${id}`),

  products: (query: AdminListQuery) =>
    apiClient.get<Paginated<AdminProduct>>("/products", {
      params: {
        q: query.q || undefined,
        limit: query.limit ?? 20,
        sort: query.sort && ["relevance", "price_asc", "price_desc", "popular", "newest"].includes(query.sort) ? query.sort : "popular",
      },
    }),
  productById: (id: number) => apiClient.get<ProductDetail>(`/products/${id}`),
  updateProduct: (id: number, payload: Record<string, unknown>) => apiClient.patch(`/admin/products/${id}`, payload),
  deleteProduct: (id: number) => apiClient.delete<{ ok: boolean }>(`/admin/products/${id}`),
  bulkImportProducts: (payload: { source: "csv" | "json"; content: string }) => apiClient.post("/admin/products/import", payload),
  bulkExportProducts: (format: "csv" | "json") => apiClient.get<{ url: string }>("/admin/products/export", { params: { format } }),

  categories: () => apiClient.get<AdminCategory[]>("/categories"),
  createCategory: (payload: { name: string; slug: string; parent_id?: number | null }) => apiClient.post<AdminCategory>("/admin/categories", payload),
  updateCategory: (id: number, payload: Partial<AdminCategory>) => apiClient.patch<AdminCategory>(`/admin/categories/${id}`, payload),
  deleteCategory: (id: number) => apiClient.delete<{ ok: boolean }>(`/admin/categories/${id}`),

  orders: (query: AdminListQuery & { status?: string }) => apiClient.get<Paginated<AdminOrder>>("/admin/orders", { params: query }),
  orderById: (id: number) => apiClient.get<AdminOrder>(`/admin/orders/${id}`),
  updateOrderStatus: (id: number, status: AdminOrder["status"]) => apiClient.patch<AdminOrder>(`/admin/orders/${id}`, { status }),

  analytics: (period: "7d" | "30d" | "90d" | "365d" = "30d") => apiClient.get<AdminMetrics>("/admin/analytics", { params: { period } }),
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
  updateStore: (id: number, payload: Partial<AdminStore>) => apiClient.patch<AdminStore>(`/admin/stores/${id}`, payload),
  deleteStore: (id: number) => apiClient.delete<{ ok: boolean }>(`/admin/stores/${id}`),
  storeSources: (storeId: number, query: AdminListQuery = {}) =>
    apiClient.get<Paginated<AdminScrapeSource>>(`/admin/stores/${storeId}/sources`, { params: query }),
  createStoreSource: (
    storeId: number,
    payload: { url: string; source_type?: string; priority?: number; is_active?: boolean },
  ) => apiClient.post<AdminScrapeSource>(`/admin/stores/${storeId}/sources`, payload),
  updateStoreSource: (storeId: number, sourceId: number, payload: Partial<AdminScrapeSource>) =>
    apiClient.patch<AdminScrapeSource>(`/admin/stores/${storeId}/sources/${sourceId}`, payload),
  deleteStoreSource: (storeId: number, sourceId: number) =>
    apiClient.delete<{ ok: boolean }>(`/admin/stores/${storeId}/sources/${sourceId}`),

  runReindex: () => apiClient.post<{ task_id: string; queued: string }>("/admin/reindex/products"),
  runEmbeddingRebuild: () => apiClient.post<{ task_id: string; queued: string }>("/admin/embeddings/rebuild"),
  runDedupe: () => apiClient.post<{ task_id: string; queued: string }>("/admin/dedupe/run"),
  runScrape: () => apiClient.post<{ task_id: string; queued: string }>("/admin/scrape/run"),
  taskStatus: (taskId: string) =>
    apiClient.get<{ task_id: string; state: string; ready: boolean; successful: boolean; progress: number; info?: Record<string, unknown> }>(
      `/admin/tasks/${taskId}`,
    ),
};

