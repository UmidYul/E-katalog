"use client";

import { useQuery } from "@tanstack/react-query";

import { catalogApi, type CatalogQuery } from "@/lib/api/openapi-client";

export const catalogKeys = {
  products: (query: CatalogQuery) => ["catalog", "products", query] as const,
  search: (query: CatalogQuery) => ["catalog", "search", query] as const,
  product: (id: string) => ["catalog", "product", id] as const,
  offers: (id: string) => ["catalog", "offers", id] as const,
  priceHistory: (id: string, days: number) => ["catalog", "price-history", id, days] as const,
  categories: ["catalog", "categories"] as const,
  brands: ["catalog", "brands"] as const,
  filters: (categoryId?: string) => ["catalog", "filters", categoryId] as const
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

export const useProduct = (id: string) =>
  useQuery({
    queryKey: catalogKeys.product(id),
    queryFn: () => catalogApi.getProduct(id),
    enabled: Boolean(id)
  });

export const useProductOffers = (id: string) =>
  useQuery({
    queryKey: catalogKeys.offers(id),
    queryFn: () => catalogApi.getOffers(id),
    enabled: Boolean(id)
  });

export const useProductPriceHistory = (id: string, days: number) =>
  useQuery({
    queryKey: catalogKeys.priceHistory(id, days),
    queryFn: () => catalogApi.getProductPriceHistory(id, days),
    enabled: Boolean(id),
    staleTime: 2 * 60_000,
    placeholderData: (previousData, previousQuery) => {
      const previousId = previousQuery?.queryKey?.[2];
      return previousId === id ? previousData : undefined;
    }
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

export const useDynamicFilters = (categoryId?: string) =>
  useQuery({
    queryKey: catalogKeys.filters(categoryId),
    queryFn: () => catalogApi.getFilters(categoryId)
  });

