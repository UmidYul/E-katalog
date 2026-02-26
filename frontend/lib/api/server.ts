import { env } from "@/config/env";

let preferredApiOrigin: string | null = null;

export async function serverGet<T>(path: string, init?: RequestInit): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const candidates = preferredApiOrigin
    ? [preferredApiOrigin, ...env.apiServerOrigins.filter((origin) => origin !== preferredApiOrigin)]
    : env.apiServerOrigins;

  let lastError: string = "API request failed";
  for (const origin of candidates) {
    const timeoutSignal = AbortSignal.timeout(5000);
    const mergedSignal = init?.signal ?? timeoutSignal;

    try {
      const response = await fetch(`${origin}${env.apiPrefix}${normalizedPath}`, {
        ...init,
        signal: mergedSignal,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        }
      });

      if (!response.ok) {
        lastError = `API request failed ${response.status}`;
        continue;
      }

      preferredApiOrigin = origin;
      return (await response.json()) as T;
    } catch {
      lastError = "API request failed network";
    }
  }

  throw new Error(lastError);
}

