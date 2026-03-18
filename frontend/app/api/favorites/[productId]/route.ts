import { NextResponse } from "next/server";

import { removeFavoriteForUser } from "@/app/api/favorites/_helpers";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ productId: string }> },
) {
  const { productId } = await context.params;
  const normalized = String(productId ?? "").trim().toLowerCase();
  if (!normalized) {
    return NextResponse.json({ error: "product_id_required" }, { status: 400 });
  }

  const result = await removeFavoriteForUser(request, normalized);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, product_id: normalized, favorited: true },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      product_id: normalized,
      favorited: false,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
