"use client";

import { useQuery } from "@tanstack/react-query";

import { catalogApi, type CatalogQuery } from "@/lib/api/openapi-client";

export const catalogKeys = {
  products: (query: CatalogQuery) => ["catalog", "products", query] as const,
  search: (query: CatalogQuery) => ["catalog", "search", query] as const,
  product: (id: number) => ["catalog", "product", id] as const,
  offers: (id: number) => ["catalog", "offers", id] as const,
  categories: ["catalog", "categories"] as const,
  brands: ["catalog", "brands"] as const,
  filters: (categoryId?: number) => ["catalog", "filters", categoryId] as const
};

export const useCatalogProducts = (query: CatalogQuery) =>
  useQuery({
    queryKey: catalogKeys.products(query),
    queryFn: () => catalogApi.listProducts(query)
  });

export const useCatalogSearch = (query: CatalogQuery) =>
  useQuery({
    queryKey: catalogKeys.search(query),
    queryFn: () => catalogApi.search(query),
    enabled: Boolean(query.q)
  });

export const useProduct = (id: number) =>
  useQuery({
    queryKey: catalogKeys.product(id),
    queryFn: () => catalogApi.getProduct(id),
    enabled: Number.isFinite(id)
  });

export const useProductOffers = (id: number) =>
  useQuery({
    queryKey: catalogKeys.offers(id),
    queryFn: () => catalogApi.getOffers(id),
    enabled: Number.isFinite(id)
  });

export const useCategories = () =>
  useQuery({
    queryKey: catalogKeys.categories,
    queryFn: () => catalogApi.getCategories()
  });

export const useBrands = () =>
  useQuery({
    queryKey: catalogKeys.brands,
    queryFn: () => catalogApi.getBrands()
  });

export const useDynamicFilters = (categoryId?: number) =>
  useQuery({
    queryKey: catalogKeys.filters(categoryId),
    queryFn: () => catalogApi.getFilters(categoryId)
  });

