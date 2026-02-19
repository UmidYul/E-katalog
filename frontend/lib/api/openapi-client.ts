import { apiClient } from "@/lib/api/client";
import type { FilterBucket, Paginated, ProductDetail, ProductListItem, ProductOffer, SortOption } from "@/types/domain";

export type CatalogQuery = {
  q?: string;
  category_id?: number;
  brand_id?: number[];
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  sort?: SortOption;
  attrs?: Record<string, string[]>;
  limit?: number;
  cursor?: string;
};

const mapArrayParam = (key: string, values?: number[]) => {
  if (!values?.length) {
    return {};
  }
  return Object.fromEntries(values.map((v, idx) => [`${key}[${idx}]`, v]));
};

const mapAttrs = (attrs?: Record<string, string[]>) => {
  if (!attrs) return {};
  const entries: Array<[string, string]> = [];
  Object.entries(attrs).forEach(([key, values]) => values.forEach((value) => entries.push([key, value])));
  return Object.fromEntries(entries.map(([key, value], idx) => [`attr[${idx}]`, `${key}:${value}`]));
};

export const catalogApi = {
  async search(query: CatalogQuery): Promise<Paginated<ProductListItem>> {
    const { attrs, ...rest } = query;
    const params = { ...rest, ...mapArrayParam("brand_id", query.brand_id), ...mapAttrs(attrs) };
    const { data } = await apiClient.get<Paginated<ProductListItem>>("/search", { params });
    return data;
  },
  async listProducts(query: CatalogQuery): Promise<Paginated<ProductListItem>> {
    const { attrs, ...rest } = query;
    const params = { ...rest, ...mapArrayParam("brand_id", query.brand_id), ...mapAttrs(attrs) };
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
  async getFilters(categoryId?: number): Promise<{ attributes?: FilterBucket[] }> {
    const { data } = await apiClient.get<{ attributes?: FilterBucket[] }>("/filters", {
      params: { category_id: categoryId }
    });
    return data;
  }
};

export const authApi = {
  login: (payload: { email: string; password: string }) => apiClient.post("/auth/login", payload),
  register: (payload: { email: string; password: string; fullName: string }) => apiClient.post("/auth/register", payload),
  logout: () => apiClient.post("/auth/logout"),
  me: () => apiClient.get<{ id: number; email: string; full_name: string }>("/auth/me")
};

export const userApi = {
  favorites: () => apiClient.get<Array<{ product_id: number }>>("/users/favorites"),
  toggleFavorite: (productId: number) => apiClient.post(`/users/favorites/${productId}`)
};

