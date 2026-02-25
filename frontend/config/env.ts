const trimTrailingSlash = (value: string) => value.replace(/\/+$/g, "");

const normalizeOrigin = (value: string | undefined | null, fallback: string) => {
  const normalized = trimTrailingSlash(String(value ?? "").trim());
  return normalized || fallback;
};

const resolveAppUrl = () => {
  const explicit = String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (explicit) return trimTrailingSlash(explicit);

  const vercelHost = String(process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "").trim();
  if (vercelHost) return `https://${trimTrailingSlash(vercelHost)}`;

  return "http://localhost:3000";
};

const appUrl = resolveAppUrl();

export const env = {
  appUrl,
  apiOrigin: trimTrailingSlash(String(process.env.NEXT_PUBLIC_API_ORIGIN ?? "").trim()),
  apiInternalOrigin: normalizeOrigin(process.env.API_INTERNAL_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN, appUrl),
  apiPrefix: process.env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1",
  siteName: process.env.NEXT_PUBLIC_SITE_NAME ?? "E-katalog"
};
