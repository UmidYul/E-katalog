import { env } from "@/config/env";

export async function serverGet<T>(path: string, init?: RequestInit): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(5000);
  const mergedSignal = init?.signal ?? timeoutSignal;

  const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}${path}`, {
    ...init,
    signal: mergedSignal,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed ${response.status}`);
  }

  return (await response.json()) as T;
}

