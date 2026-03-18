import { NextResponse } from "next/server";

import { env } from "@/config/env";

type AlertPayload = {
  productId?: string;
  currentPrice?: number | null;
  targetPrice?: number | null;
  contact?: string | null;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as AlertPayload;
  const productId = String(payload.productId ?? "").trim();

  if (!productId) {
    return NextResponse.json({ error: "product_id_required" }, { status: 400 });
  }

  try {
    const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}/products/${productId}/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        alerts_enabled: true,
        current_price: payload.currentPrice ?? null,
        target_price: payload.targetPrice ?? null,
        channel: "telegram",
      }),
      cache: "no-store",
    });

    if (response.ok) {
      return NextResponse.json(await response.json(), {
        headers: { "Cache-Control": "no-store" },
      });
    }
  } catch {
    // fall through to guest success response
  }

  const guestContact = String(payload.contact ?? "").trim();
  return NextResponse.json(
    {
      ok: true,
      mode: "guest",
      contact: guestContact || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
