import type { MetadataRoute } from "next";

import { env } from "@/config/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api", "/dashboard", "/login", "/register", "/profile", "/favorites", "/recently-viewed"]
    },
    host: env.appUrl,
    sitemap: `${env.appUrl}/sitemap.xml`
  };
}

