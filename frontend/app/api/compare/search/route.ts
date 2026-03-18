import { NextResponse } from "next/server";

import { buildProductSlug } from "@/features/product/product-types";
import { serverGet } from "@/lib/api/server";

type SearchResponse = {
  items: Array<{
    id: string;
    normalized_title: string;
    image_url?: string | null;
    min_price?: number | null;
    category?: { id?: string; name?: string } | null;
  }>;
};

const parseIds = (value: string | null) => {
  if (!value) return new Set<string>();
  return new Set(
    value
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") ?? "").trim();
  const exclude = parseIds(url.searchParams.get("exclude"));

  const params = new URLSearchParams({
    sort: "popular",
    limit: "12",
  });
  if (q) params.set("q", q);

  try {
    const response = await serverGet<SearchResponse>(`/products?${params.toString()}`);
    const items = (response.items ?? [])
      .filter((item) => !exclude.has(String(item.id).toLowerCase()))
      .slice(0, 12)
      .map((item) => ({
        id: String(item.id),
        name: String(item.normalized_title ?? "Товар"),
        slug: buildProductSlug(String(item.id), String(item.normalized_title ?? "Товар")),
        image: item.image_url ?? null,
        minPrice: Number(item.min_price ?? 0),
        category: item.category?.name ?? null,
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
