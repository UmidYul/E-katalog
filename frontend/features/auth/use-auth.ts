"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authApi, type AuthUser } from "@/lib/api/openapi-client";
import { clearAnonymousFavorites, readFavoriteIds, readFavoriteMetaMap } from "@/lib/utils/favorites";
import { authStore } from "@/store/auth.store";
import { useCompareStore } from "@/store/compare.store";

const isUnauthorizedError = (error: unknown): error is { status: number } =>
  Boolean(error && typeof error === "object" && "status" in error && (error as { status?: unknown }).status === 401);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const PHONE_REGEX = /^(?:\+?998)?\d{9}$/;

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return null;
};

export const contactToAuthEmail = (value: string) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("@")) return normalized;
  if (!PHONE_REGEX.test(normalized)) return normalized;
  const phone = normalizePhone(normalized);
  if (!phone) return normalized;
  return `${phone.slice(1)}@phone.doxx.uz`;
};

export const syncAnonymousStateAfterAuth = async () => {
  if (typeof window === "undefined") return;

  const favoriteIds = readFavoriteIds();
  const favoriteMeta = readFavoriteMetaMap();
  let mergedFavorites = 0;

  for (const id of favoriteIds) {
    try {
      const response = await fetch("/api/favorites/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: id,
          currentPrice: favoriteMeta[id]?.savedPrice ?? null,
        }),
        cache: "no-store",
      });
      if (response.ok) mergedFavorites += 1;
    } catch {
      // ignore merge errors
    }
  }

  if (favoriteIds.length > 0 && mergedFavorites === favoriteIds.length) {
    clearAnonymousFavorites();
  }

  const compareIds = useCompareStore.getState().ids;
  let idsForSync = compareIds;
  if (idsForSync.length === 0) {
    try {
      const raw = window.localStorage.getItem("doxx_compare");
      const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
      idsForSync = Array.isArray(parsed)
        ? parsed.map((id) => String(id).trim().toLowerCase()).filter(Boolean).slice(0, 4)
        : [];
    } catch {
      idsForSync = [];
    }
  }

  if (idsForSync.length > 0) {
    try {
      await fetch("/api/user/compare", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idsForSync }),
        cache: "no-store",
      });
    } catch {
      // ignore compare sync errors
    }
  }
};

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
      await syncAnonymousStateAfterAuth();
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
    onSuccess: () => {
      authStore.getState().clearSession();
      clearAnonymousFavorites();
      useCompareStore.getState().clearAll();
      queryClient.clear();
      if (typeof window !== "undefined") {
        window.location.assign("/");
      }
    }
  });
};

