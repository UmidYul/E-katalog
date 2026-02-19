import axios from "axios";

import { env } from "@/config/env";
import { attachInterceptors } from "@/lib/api/interceptors";

export const apiClient = axios.create({
  baseURL: `${env.apiOrigin}${env.apiPrefix}`,
  withCredentials: true,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json"
  }
});

attachInterceptors(apiClient);

