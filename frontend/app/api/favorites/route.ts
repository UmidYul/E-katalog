import { NextResponse } from "next/server";

import {
  listFavoriteItemsWithDetails,
  toggleFavoriteForUser,
} from "@/app/api/favorites/_helpers";

type FavoritePayload = {
  productId?: string;
  currentPrice?: number | null;
};

export async function GET(request: Request) {
  const { status, items } = await listFavoriteItemsWithDetails(request);
  if (status === 401) {
    return NextResponse.json([], {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (status !== 200) {
    return NextResponse.json([], {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(items, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as FavoritePayload;
  const productId = String(payload.productId ?? "").trim().toLowerCase();

  if (!productId) {
    return NextResponse.json({ error: "product_id_required" }, { status: 400 });
  }

  const result = await toggleFavoriteForUser(request, productId, payload.currentPrice ?? null);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, product_id: productId, favorited: false },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      product_id: productId,
      favorited: result.favorited,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
