"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { sellerApi } from "@/lib/api/openapi-client";

export const sellerKeys = {
  shop: ["seller", "shop"] as const,
  products: (status: string, q: string, limit: number, offset: number) =>
    ["seller", "products", status, q, limit, offset] as const,
  product: (productId?: string) => ["seller", "product", productId ?? "none"] as const,
  inventoryLog: (productId?: string, limit: number = 50, offset: number = 0) =>
    ["seller", "inventory-log", productId ?? "none", limit, offset] as const,
  statusHistory: (productId?: string, limit: number = 50, offset: number = 0) =>
    ["seller", "status-history", productId ?? "none", limit, offset] as const,
  applicationStatus: (email?: string, phone?: string) => ["seller", "application-status", email ?? "", phone ?? ""] as const,
};

export function useSellerShop() {
  return useQuery({
    queryKey: sellerKeys.shop,
    queryFn: async () => (await sellerApi.shop()).data,
    staleTime: 15_000,
  });
}

export function useUpdateSellerShop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      shop_name?: string;
      website_url?: string | null;
      contact_email?: string;
      contact_phone?: string;
      logo_url?: string | null;
      banner_url?: string | null;
      brand_color?: string | null;
    }) =>
      (await sellerApi.updateShop(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sellerKeys.shop });
    },
  });
}

export function useSellerProducts(query: { status?: string; q?: string; limit?: number; offset?: number } = {}) {
  const status = query.status ?? "all";
  const q = query.q ?? "";
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  return useQuery({
    queryKey: sellerKeys.products(status, q, limit, offset),
    queryFn: async () => (await sellerApi.products({ status: status === "all" ? undefined : status, q: q || undefined, limit, offset })).data,
    staleTime: 10_000,
  });
}

export function useSellerProduct(productId?: string) {
  return useQuery({
    queryKey: sellerKeys.product(productId),
    queryFn: async () => {
      if (!productId) {
        throw new Error("product id is required");
      }
      return (await sellerApi.productById(productId)).data;
    },
    enabled: Boolean(productId),
    staleTime: 10_000,
  });
}

export function useSellerInventoryLog(productId?: string, query: { limit?: number; offset?: number } = {}) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  return useQuery({
    queryKey: sellerKeys.inventoryLog(productId, limit, offset),
    queryFn: async () => {
      if (!productId) {
        throw new Error("product id is required");
      }
      return (await sellerApi.productInventoryLog(productId, { limit, offset })).data;
    },
    enabled: Boolean(productId),
    staleTime: 10_000,
  });
}

export function useSellerProductStatusHistory(productId?: string, query: { limit?: number; offset?: number } = {}) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  return useQuery({
    queryKey: sellerKeys.statusHistory(productId, limit, offset),
    queryFn: async () => {
      if (!productId) {
        throw new Error("product id is required");
      }
      return (await sellerApi.productStatusHistory(productId, { limit, offset })).data;
    },
    enabled: Boolean(productId),
    staleTime: 10_000,
  });
}

export function useCreateSellerProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
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
    }) => (await sellerApi.createProduct(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["seller", "products"] });
    },
  });
}

export function useUpdateSellerProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      productId: string;
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
    }) => {
      const { productId, ...body } = payload;
      return (await sellerApi.updateProduct(productId, body)).data;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["seller", "products"] });
      await queryClient.invalidateQueries({ queryKey: sellerKeys.product(result.id) });
      await queryClient.invalidateQueries({ queryKey: ["seller", "status-history", result.id] });
    },
  });
}

export function useArchiveSellerProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => (await sellerApi.archiveProduct(productId)).data,
    onSuccess: async (_, productId) => {
      await queryClient.invalidateQueries({ queryKey: ["seller", "products"] });
      await queryClient.invalidateQueries({ queryKey: sellerKeys.product(productId) });
      await queryClient.invalidateQueries({ queryKey: ["seller", "status-history", productId] });
    },
  });
}

export function usePatchSellerProductStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { productId: string; quantity: number; comment?: string | null }) =>
      (await sellerApi.patchProductStock(payload.productId, { quantity: payload.quantity, comment: payload.comment })).data,
    onSuccess: async (_, payload) => {
      await queryClient.invalidateQueries({ queryKey: ["seller", "products"] });
      await queryClient.invalidateQueries({ queryKey: sellerKeys.product(payload.productId) });
      await queryClient.invalidateQueries({ queryKey: ["seller", "inventory-log", payload.productId] });
    },
  });
}

export function useCreateSellerApplication() {
  return useMutation({
    mutationFn: async (payload: {
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
    }) => (await sellerApi.createApplication(payload)).data,
  });
}

export function useSellerApplicationStatus(query?: { email?: string; phone?: string }) {
  const email = String(query?.email ?? "").trim().toLowerCase();
  const phone = String(query?.phone ?? "").trim();
  return useQuery({
    queryKey: sellerKeys.applicationStatus(email, phone),
    queryFn: async () => (await sellerApi.applicationStatus({ email, phone })).data,
    enabled: Boolean(email && phone),
    retry: false,
  });
}
