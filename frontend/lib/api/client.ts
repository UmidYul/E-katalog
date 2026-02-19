import axios from "axios";

import { env } from "@/config/env";
import { attachInterceptors } from "@/lib/api/interceptors";

export const apiClient = axios.create({
  baseURL: `${env.apiOrigin}${env.apiPrefix}`,
  withCredentials: true,
  timeout: 15000,
  paramsSerializer: {
    serialize: (params) => {
      const search = new URLSearchParams();
      Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item !== undefined && item !== null) {
              search.append(key, String(item));
            }
          });
          return;
        }
        search.append(key, String(value));
      });
      return search.toString();
    }
  },
  headers: {
    "Content-Type": "application/json"
  }
});

attachInterceptors(apiClient);

