const required = ["NEXT_PUBLIC_API_ORIGIN", "NEXT_PUBLIC_API_PREFIX", "NEXT_PUBLIC_APP_URL"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL as string,
  apiOrigin: process.env.NEXT_PUBLIC_API_ORIGIN as string,
  apiPrefix: process.env.NEXT_PUBLIC_API_PREFIX as string,
  siteName: process.env.NEXT_PUBLIC_SITE_NAME ?? "ZincMarket"
};

