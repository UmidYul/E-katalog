import { NextResponse } from "next/server";

import { env } from "@/config/env";

type SellerStatusRouteResponse = {
  ok: boolean;
  applicationId?: string;
  status?: "pending" | "review" | "approved" | "rejected";
  reviewNote?: string | null;
  updatedAt?: string | null;
  message?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get("email") ?? "").trim().toLowerCase();
  const id = String(url.searchParams.get("id") ?? "").trim();

  if (!email && !id) {
    return NextResponse.json(
      {
        ok: false,
        message: "Email ёки ариза ID киритинг.",
      } satisfies SellerStatusRouteResponse,
      { status: 422 },
    );
  }

  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (id) params.set("id", id);

  try {
    const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}/seller-applications/status?${params.toString()}`, {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: String(payload.message ?? "Статус топилмади."),
        } satisfies SellerStatusRouteResponse,
        { status: response.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        applicationId: String(payload.application_id ?? payload.id ?? ""),
        status: String(payload.status ?? "pending") as SellerStatusRouteResponse["status"],
        reviewNote: (payload.review_note as string | null | undefined) ?? null,
        updatedAt: (payload.updated_at as string | null | undefined) ?? null,
      } satisfies SellerStatusRouteResponse,
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Серверга уланишда хатолик.",
      } satisfies SellerStatusRouteResponse,
      { status: 500 },
    );
  }
}
