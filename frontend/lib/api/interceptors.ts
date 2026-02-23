import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";

import { authStore } from "@/store/auth.store";

type NormalizedError = {
  status: number;
  message: string;
  code?: string;
  details?: unknown;
};

const extractDetailMessage = (detail: unknown): string | undefined => {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    for (const entry of detail) {
      if (entry && typeof entry === "object" && "msg" in entry && typeof (entry as { msg?: unknown }).msg === "string") {
        return (entry as { msg: string }).msg;
      }
    }
  }
  if (detail && typeof detail === "object" && "message" in detail && typeof (detail as { message?: unknown }).message === "string") {
    return (detail as { message: string }).message;
  }
  return undefined;
};

const normalizeError = (error: AxiosError): NormalizedError => {
  const status = error.response?.status ?? 500;
  const payload = error.response?.data as
    | {
        message?: string;
        detail?: unknown;
        error?: { message?: string; code?: string; details?: unknown };
      }
    | undefined;
  const detailMessage = extractDetailMessage(payload?.detail);
  return {
    status,
    message: payload?.error?.message ?? payload?.message ?? detailMessage ?? error.message,
    code: payload?.error?.code,
    details: payload?.error?.details ?? payload?.detail
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

      const requestUrl = String(original?.url ?? "");
      const isRefreshCall = requestUrl.includes("/auth/refresh");
      const isAuthCall = requestUrl.includes("/auth/");
      const isLoginOrRegisterCall = requestUrl.includes("/auth/login") || requestUrl.includes("/auth/register");
      const isAuthMeCall = requestUrl.includes("/auth/me");
      const isGuestOptionalCall = Boolean(original?.url?.includes("/users/favorites"));
      const canTryRefresh = !isRefreshCall && !isGuestOptionalCall && (!isAuthCall || isAuthMeCall) && !isLoginOrRegisterCall;

      if (error.response?.status === 401 && !original?._retry && canTryRefresh) {
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

