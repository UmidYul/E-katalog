import { NextResponse } from "next/server";

import { serverGet } from "@/lib/api/server";

type SearchResponse = {
  items: Array<{
    id: string;
  }>;
};

const getPresetQuery = (kind: string) => {
  if (kind === "smartphones_top") {
    return new URLSearchParams({
      q: "смартфон",
      sort: "popular",
      limit: "6",
    }).toString();
  }

  if (kind === "laptops_20m") {
    return new URLSearchParams({
      q: "ноутбук",
      sort: "popular",
      max_price: "20000000",
      limit: "6",
    }).toString();
  }

  return new URLSearchParams({
    sort: "popular",
    limit: "6",
  }).toString();
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = String(url.searchParams.get("kind") ?? "smartphones_top");
  const query = getPresetQuery(kind);

  try {
    const response = await serverGet<SearchResponse>(`/products?${query}`);
    const ids = (response.items ?? [])
      .map((item) => String(item.id).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 3);

    return NextResponse.json(
      {
        ids,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ids: [],
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
