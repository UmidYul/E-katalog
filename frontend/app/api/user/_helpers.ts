import { env } from "@/config/env";

export const userBackendFetch = async (
  request: Request,
  path: string,
  init?: RequestInit,
) => {
  const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
      ...(init?.headers ?? {}),
    },
  });

  return response;
};

export const safeParseJson = async <T>(response: Response, fallback: T): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
};
