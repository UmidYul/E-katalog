import { env } from "@/config/env";

export async function serverGet<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.apiOrigin}${env.apiPrefix}${path}`, {
    ...init,
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

