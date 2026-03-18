import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

type ComparePayload = {
  ids?: string[];
};

export async function GET(request: Request) {
  const response = await userBackendFetch(request, "/users/me/compare");
  const payload = await safeParseJson<{ ids: string[] }>(response, { ids: [] });
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as ComparePayload;
  const ids = Array.isArray(payload.ids) ? payload.ids.map((id) => String(id).trim().toLowerCase()).filter(Boolean) : [];
  const response = await userBackendFetch(request, "/users/me/compare", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
  const body = await safeParseJson<{ ids: string[] }>(response, { ids: [] });
  return NextResponse.json(body, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
