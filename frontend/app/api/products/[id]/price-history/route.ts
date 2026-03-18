import { NextResponse } from "next/server";

import type { ProductPriceHistoryPoint } from "@/features/product/product-types";
import { serverGet } from "@/lib/api/server";

type RouteParams = { params: { id: string } };

type RawHistoryPoint = {
  date: string;
  shop_id?: string | null;
  shop_name?: string | null;
  price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
};

const periodToDays = (period: string | null) => {
  if (period === "7d") return 7;
  if (period === "90d") return 90;
  if (period === "all") return 365;
  return 30;
};

export async function GET(request: Request, { params }: RouteParams) {
  const url = new URL(request.url);
  const days = periodToDays(url.searchParams.get("period"));
  const shopId = String(url.searchParams.get("shopId") ?? "all").trim();

  try {
    const backendSearch = new URLSearchParams({ days: String(days) });
    if (shopId && shopId !== "all") backendSearch.set("shop_id", shopId);

    const history = await serverGet<RawHistoryPoint[]>(`/products/${params.id}/price-history?${backendSearch.toString()}`);
    const points: ProductPriceHistoryPoint[] = (history ?? []).map((item) => ({
      date: item.date,
      price: Number(item.price ?? item.min_price ?? item.max_price ?? 0),
      shopId: String(item.shop_id ?? shopId ?? "all"),
      shopName: String(item.shop_name ?? "Барча дўконлар"),
    }));

    return NextResponse.json(points, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json([], {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
