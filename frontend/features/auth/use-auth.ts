"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authApi } from "@/lib/api/openapi-client";
import { authStore } from "@/store/auth.store";

const isUnauthorizedError = (error: unknown): error is { status: number } =>
  Boolean(error && typeof error === "object" && "status" in error && (error as { status?: unknown }).status === 401);

export const useAuthMe = (enabled = true) =>
  useQuery({
    queryKey: ["auth", "me"],
    enabled,
    queryFn: async () => {
      try {
        const { data } = await authApi.me();
        authStore.getState().setSession(data);
        return data;
      } catch (error) {
        if (isUnauthorizedError(error)) {
          authStore.getState().clearSession();
          return null;
        }
        throw error;
      }
    },
    retry: false
  });

export const useLogin = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });
};

export const useRegister = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });
};

export const useLogout = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      authStore.getState().clearSession();
      await queryClient.clear();
    }
  });
};

