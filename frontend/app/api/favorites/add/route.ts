import { NextResponse } from "next/server";

import { addFavoriteForUser } from "@/app/api/favorites/_helpers";

type FavoritePayload = {
  productId?: string;
  currentPrice?: number | null;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as FavoritePayload;
  const productId = String(payload.productId ?? "").trim().toLowerCase();
  if (!productId) {
    return NextResponse.json({ error: "product_id_required" }, { status: 400 });
  }

  const result = await addFavoriteForUser(request, productId, payload.currentPrice ?? null);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, product_id: productId, favorited: false },
      { status: result.status },
    );
  }

  return NextResponse.json(
    { ok: true, product_id: productId, favorited: true },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
