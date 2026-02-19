import type { MetadataRoute } from "next";

import { env } from "@/config/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api", "/profile", "/favorites", "/recently-viewed"]
    },
    sitemap: `${env.appUrl}/sitemap.xml`
  };
}

