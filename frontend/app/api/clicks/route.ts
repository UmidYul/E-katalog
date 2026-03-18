import { NextResponse } from "next/server";

import { env } from "@/config/env";

type ClickPayload = {
  productId?: string;
  offerId?: string;
  shopId?: string;
  timestamp?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as ClickPayload;
  const offerId = String(payload.offerId ?? "").trim();

  if (offerId) {
    try {
      const query = new URLSearchParams({
        source_page: "product_page",
        placement: "offers_panel",
        no_redirect: "1",
      });

      await fetch(`${env.apiInternalOrigin}${env.apiPrefix}/go/${offerId}?${query.toString()}`, {
        method: "POST",
        headers: {
          cookie: request.headers.get("cookie") ?? "",
        },
        cache: "no-store",
      });
    } catch {
      // tracking failure should not break UX
    }
  }

  return NextResponse.json(
    {
      ok: true,
      productId: payload.productId ?? null,
      offerId: payload.offerId ?? null,
      shopId: payload.shopId ?? null,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
