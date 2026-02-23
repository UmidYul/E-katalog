"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { userApi } from "@/lib/api/openapi-client";
import { authStore } from "@/store/auth.store";

export const useFavorites = () =>
  useQuery({
    queryKey: ["user", "favorites"],
    queryFn: async () => {
      try {
        const { data } = await userApi.favorites();
        return data;
      } catch (error) {
        const normalized = error as { status?: number };
        if (normalized.status === 401) {
          return [];
        }
        throw error;
      }
    },
    retry: false,
    enabled: authStore((s) => s.isAuthenticated),
  });

export const useToggleFavorite = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (productId: string) => userApi.toggleFavorite(productId),
    onMutate: async (productId) => {
      await queryClient.cancelQueries({ queryKey: ["user", "favorites"] });
      const previous = queryClient.getQueryData<Array<{ product_id: string }>>(["user", "favorites"]);
      const has = previous?.some((x) => x.product_id === productId);
      const next = has ? previous?.filter((x) => x.product_id !== productId) : [...(previous ?? []), { product_id: productId }];
      queryClient.setQueryData(["user", "favorites"], next);
      return { previous };
    },
    onError: (_error, _productId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["user", "favorites"], context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["user", "favorites"] });
    }
  });
};

