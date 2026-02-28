const trimTrailingSlash = (value: string) => value.replace(/\/+$/g, "");

const normalizeOrigin = (value: string | undefined | null, fallback: string) => {
  const normalized = trimTrailingSlash(String(value ?? "").trim());
  return normalized || fallback;
};

const uniqueNonEmpty = (values: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = trimTrailingSlash(String(raw ?? "").trim());
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const resolveAppUrl = () => {
  const explicit = String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (explicit) return trimTrailingSlash(explicit);

  const vercelHost = String(process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "").trim();
  if (vercelHost) return `https://${trimTrailingSlash(vercelHost)}`;

  return "http://localhost:3000";
};

const appUrl = resolveAppUrl();
const apiOrigin = trimTrailingSlash(String(process.env.NEXT_PUBLIC_API_ORIGIN ?? "").trim());
const apiInternalOrigin = normalizeOrigin(process.env.API_INTERNAL_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN, appUrl);
const apiServerOrigins = uniqueNonEmpty([apiInternalOrigin, apiOrigin, appUrl]);

export const env = {
  appUrl,
  apiOrigin,
  apiInternalOrigin,
  apiServerOrigins,
  apiPrefix: process.env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1",
  siteName: process.env.NEXT_PUBLIC_SITE_NAME ?? "Doxx"
};

