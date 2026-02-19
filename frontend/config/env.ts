export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  apiOrigin: process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:8000",
  apiPrefix: process.env.NEXT_PUBLIC_API_PREFIX ?? "/api/v1",
  siteName: process.env.NEXT_PUBLIC_SITE_NAME ?? "ZincMarket"
};

