import type { MetadataRoute } from "next";

import { env } from "@/config/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/catalog", "/category/", "/product/", "/compare", "/become-seller", "/contacts", "/terms", "/privacy", "/cookies"],
      disallow: ["/api", "/dashboard", "/login", "/register", "/profile", "/favorites", "/recently-viewed"]
    },
    host: env.appUrl,
    sitemap: `${env.appUrl}/sitemap.xml`
  };
}
