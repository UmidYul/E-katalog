import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";

import { authStore } from "@/store/auth.store";

type NormalizedError = {
  status: number;
  message: string;
  code?: string;
  details?: unknown;
};

const normalizeError = (error: AxiosError): NormalizedError => {
  const status = error.response?.status ?? 500;
  const payload = error.response?.data as { error?: { message?: string; code?: string; details?: unknown } } | undefined;
  return {
    status,
    message: payload?.error?.message ?? error.message,
    code: payload?.error?.code,
    details: payload?.error?.details
  };
};

let isRefreshing = false;
let refreshPromise: Promise<AxiosResponse<{ ok: boolean }>> | null = null;

export const attachInterceptors = (client: AxiosInstance) => {
  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const requestId = crypto.randomUUID();
    config.headers.set("X-Request-ID", requestId);
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      const isRefreshCall = Boolean(original?.url?.includes("/auth/refresh"));
      const isGuestOptionalCall = Boolean(original?.url?.includes("/users/favorites"));

      if (error.response?.status === 401 && !original?._retry && !isRefreshCall && !isGuestOptionalCall) {
        original._retry = true;

        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = client.post<{ ok: boolean }>("/auth/refresh", undefined, { withCredentials: true });
        }

        try {
          await refreshPromise;
          isRefreshing = false;
          refreshPromise = null;
          return client(original);
        } catch {
          isRefreshing = false;
          refreshPromise = null;
          authStore.getState().clearSession();
        }
      }

      return Promise.reject(normalizeError(error));
    }
  );
};

