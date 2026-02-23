"use client";

import { useQuery } from "@tanstack/react-query";

import { catalogApi } from "@/lib/api/openapi-client";

export const compareKeys = {
  matrix: (productIds: string[]) => ["compare", "matrix", productIds] as const
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeEntityRef = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
};

export const useCompareProducts = (productIds: string[]) => {
  const normalizedIds = Array.from(
    new Set(productIds.map(normalizeEntityRef).filter((value): value is string => Boolean(value && UUID_PATTERN.test(value))))
  );
  return useQuery({
    queryKey: compareKeys.matrix(normalizedIds),
    queryFn: () => catalogApi.compareProducts(normalizedIds),
    enabled: normalizedIds.length >= 2
  });
};
