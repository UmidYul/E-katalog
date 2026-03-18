import { NextResponse } from "next/server";

import { buildProductSlug, type ProductApiResponse, type SimilarProductItem } from "@/features/product/product-types";
import { serverGet } from "@/lib/api/server";

type RouteParams = { params: { id: string } };

type ProductSearchResponse = {
  items: Array<{
    id: string;
    normalized_title: string;
    image_url?: string | null;
    min_price?: number | null;
    store_count?: number;
  }>;
};

type SimilarBackendItem = {
  id: string;
  normalized_title: string;
  image_url?: string | null;
  min_price?: number | null;
  store_count?: number | null;
};

const parseLimit = (value: string | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(12, Math.round(parsed)));
};

export async function GET(request: Request, { params }: RouteParams) {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));

  try {
    const fromDedicatedEndpoint = await serverGet<SimilarBackendItem[]>(`/products/${params.id}/similar?limit=${limit}`).catch(() => null);
    if (Array.isArray(fromDedicatedEndpoint) && fromDedicatedEndpoint.length) {
      const mapped: SimilarProductItem[] = fromDedicatedEndpoint
        .filter((item) => item.id !== params.id)
        .slice(0, limit)
        .map((item) => ({
          id: item.id,
          slug: buildProductSlug(item.id, item.normalized_title),
          name: item.normalized_title,
          image: item.image_url ?? null,
          minPrice: Number(item.min_price ?? 0),
          shopCount: Number(item.store_count ?? 0),
        }));

      return NextResponse.json(mapped, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const product = await serverGet<ProductApiResponse>(`/products/${params.id}`);
    const offers = product.offers_by_store ?? [];
    const minPrice = offers.length
      ? Math.min(...offers.map((store) => Number(store.minimal_price ?? Number.POSITIVE_INFINITY)))
      : 0;

    const searchParams = new URLSearchParams({
      sort: "popular",
      limit: String(limit + 12),
    });

    if (minPrice > 0) {
      searchParams.set("min_price", String(Math.floor(minPrice * 0.7)));
      searchParams.set("max_price", String(Math.ceil(minPrice * 1.3)));
    }

    if (product.brand) searchParams.set("q", String(product.brand));

    const similarRaw = await serverGet<ProductSearchResponse>(`/products?${searchParams.toString()}`);
    const items: SimilarProductItem[] = (similarRaw.items ?? [])
      .filter((item) => item.id !== params.id)
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        slug: buildProductSlug(item.id, item.normalized_title),
        name: item.normalized_title,
        image: item.image_url ?? null,
        minPrice: Number(item.min_price ?? 0),
        shopCount: Number(item.store_count ?? 0),
      }));

    return NextResponse.json(items, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json([], {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
