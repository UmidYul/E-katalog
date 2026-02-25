import type { MetadataRoute } from "next";

import { env } from "@/config/env";

type Category = { slug: string };
type Brand = { name: string; products_count?: number };
type ProductListItem = { id: string; normalized_title: string };
type ProductPage = { items: ProductListItem[]; next_cursor?: string | null };

const PRODUCT_PAGE_SIZE = 100;
const MAX_PRODUCT_PAGES = 250;
const MAX_PRODUCTS_IN_SITEMAP = 25000;
const SITEMAP_REVALIDATE_SECONDS = 3600;
const SITEMAP_FETCH_TIMEOUT_MS = 8000;

export const revalidate = SITEMAP_REVALIDATE_SECONDS;
export const dynamic = "force-dynamic";

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const baseUrl = env.appUrl.endsWith("/") ? env.appUrl.slice(0, -1) : env.appUrl;
const normalizeOrigin = (value: string) => String(value || "").trim().replace(/\/+$/g, "");
const apiOrigins = Array.from(new Set([env.apiInternalOrigin, env.apiOrigin, baseUrl].map(normalizeOrigin).filter(Boolean)));
let preferredApiOrigin: string | null = null;

const absoluteUrl = (route: string) => {
  if (!route) return baseUrl;
  return `${baseUrl}${route.startsWith("/") ? route : `/${route}`}`;
};

async function fetchApi<T>(path: string): Promise<T | null> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const candidates = preferredApiOrigin ? [preferredApiOrigin, ...apiOrigins.filter((origin) => origin !== preferredApiOrigin)] : apiOrigins;

  for (const origin of candidates) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SITEMAP_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${origin}${env.apiPrefix}${normalizedPath}`, {
        signal: controller.signal,
        next: { revalidate: SITEMAP_REVALIDATE_SECONDS },
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) continue;
      preferredApiOrigin = origin;
      return (await response.json()) as T;
    } catch {
      continue;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return null;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries = new Map<string, MetadataRoute.Sitemap[number]>();

  const add = (
    route: string,
    options: {
      changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
      priority?: number;
    } = {}
  ) => {
    const url = absoluteUrl(route);
    if (entries.has(url)) return;
    entries.set(url, {
      url,
      lastModified: now,
      changeFrequency: options.changeFrequency ?? "daily",
      priority: options.priority ?? 0.7
    });
  };

  add("", { changeFrequency: "daily", priority: 1 });
  add("/catalog", { changeFrequency: "daily", priority: 0.9 });
  add("/compare", { changeFrequency: "weekly", priority: 0.4 });

  const [categories, brands] = await Promise.all([
    fetchApi<Category[]>("/categories"),
    fetchApi<Brand[]>("/brands?limit=200")
  ]);

  for (const category of categories ?? []) {
    const slug = String(category?.slug || "").trim();
    if (!slug) continue;
    add(`/category/${slug}`, { changeFrequency: "daily", priority: 0.85 });
  }

  for (const brand of brands ?? []) {
    const count = Number(brand?.products_count ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    const slug = slugify(String(brand?.name || ""));
    if (!slug) continue;
    add(`/category/brand-${slug}`, { changeFrequency: "daily", priority: 0.8 });
  }

  let cursor: string | null = null;
  let pagesLoaded = 0;
  let productsAdded = 0;

  while (pagesLoaded < MAX_PRODUCT_PAGES && productsAdded < MAX_PRODUCTS_IN_SITEMAP) {
    const query = new URLSearchParams({
      limit: String(PRODUCT_PAGE_SIZE),
      sort: "popular"
    });
    if (cursor) query.set("cursor", cursor);

    const page = await fetchApi<ProductPage>(`/products?${query.toString()}`);
    if (!page || !Array.isArray(page.items) || page.items.length === 0) break;

    for (const item of page.items) {
      const id = String(item?.id || "").trim();
      if (!id) continue;
      const slug = slugify(String(item?.normalized_title || "")) || "product";
      add(`/product/${id}-${slug}`, { changeFrequency: "daily", priority: 0.8 });
      productsAdded += 1;
      if (productsAdded >= MAX_PRODUCTS_IN_SITEMAP) break;
    }

    cursor = typeof page.next_cursor === "string" && page.next_cursor ? page.next_cursor : null;
    pagesLoaded += 1;
    if (!cursor) break;
  }

  return Array.from(entries.values());
}

