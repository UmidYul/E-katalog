"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { authApi, type AuthUser } from "@/lib/api/openapi-client";
import { authStore } from "@/store/auth.store";

const isUnauthorizedError = (error: unknown): error is { status: number } =>
  Boolean(error && typeof error === "object" && "status" in error && (error as { status?: unknown }).status === 401);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

  const syncSession = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { data } = await authApi.me();
        authStore.getState().setSession(data);
        queryClient.setQueryData(["auth", "me"], data);
        return data;
      } catch (error) {
        if (isUnauthorizedError(error) && attempt < 2) {
          await wait(120 * (attempt + 1));
          continue;
        }
        if (isUnauthorizedError(error)) {
          authStore.getState().clearSession();
          queryClient.setQueryData(["auth", "me"], null);
          return null;
        }
        throw error;
      }
    }
    return null;
  };

  return useMutation({
    mutationFn: authApi.login,
    onSuccess: async (response) => {
      if (response.data && typeof response.data === "object" && "requires_2fa" in response.data && response.data.requires_2fa === true) {
        return;
      }
      if (response.data && typeof response.data === "object" && "id" in response.data) {
        authStore.getState().setSession(response.data as AuthUser);
        queryClient.setQueryData(["auth", "me"], response.data as AuthUser);
      }
      await syncSession();
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
  const router = useRouter();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      authStore.getState().clearSession();
      queryClient.clear();
      router.replace("/");
      router.refresh();
    }
  });
};

