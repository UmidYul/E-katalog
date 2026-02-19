"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authApi } from "@/lib/api/openapi-client";
import { authStore } from "@/store/auth.store";

export const useAuthMe = () =>
  useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const { data } = await authApi.me();
      authStore.getState().setSession(data);
      return data;
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

