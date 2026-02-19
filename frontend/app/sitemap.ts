import type { MetadataRoute } from "next";

import { env } from "@/config/env";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = ["", "/catalog", "/login", "/register", "/profile", "/favorites", "/recently-viewed"];

  return routes.map((route) => ({
    url: `${env.appUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "daily" : "hourly",
    priority: route === "" ? 1 : 0.7
  }));
}

