import { NextResponse } from "next/server";

import { env } from "@/config/env";

type RecentlyViewedPayload = {
  productId?: string;
};

export async function GET(request: Request) {
  try {
    const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}/users/me/recently-viewed`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json([], { status: response.status, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json(await response.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RecentlyViewedPayload;
  const productId = String(payload.productId ?? "").trim();

  if (!productId) {
    return NextResponse.json({ error: "product_id_required" }, { status: 400 });
  }

  try {
    const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}/users/me/recently-viewed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ product_id: productId }),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false }, { status: response.status });
    }

    return NextResponse.json(await response.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}/users/me/recently-viewed`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false }, { status: response.status });
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
