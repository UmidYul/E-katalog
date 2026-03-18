import { NextResponse } from "next/server";

import {
  buildProductSlug,
  mapProductApiToPageData,
  type ProductApiResponse,
  type ProductReviewItem,
} from "@/features/product/product-types";
import { serverGet } from "@/lib/api/server";

type RouteParams = { params: { id: string } };

export async function GET(request: Request, { params }: RouteParams) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const endpoint = query ? `/products/${params.id}?${query}` : `/products/${params.id}`;

  try {
    const [product, reviews] = await Promise.all([
      serverGet<ProductApiResponse>(endpoint),
      serverGet<ProductReviewItem[]>(`/products/${params.id}/reviews?limit=60&offset=0`).catch(() => []),
    ]);

    const payload = mapProductApiToPageData(product, {
      slug: buildProductSlug(params.id, product.title ?? ""),
      reviews,
      similar: [],
    });

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
