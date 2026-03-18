import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

type RouteParams = { params: { id: string } };

export async function DELETE(request: Request, { params }: RouteParams) {
  const alertId = String(params.id ?? "").trim();
  if (!alertId) {
    return NextResponse.json({ error: "alert_id_required" }, { status: 400 });
  }

  const response = await userBackendFetch(request, `/users/me/alerts/${alertId}`, {
    method: "DELETE",
  });
  const payload = await safeParseJson<Record<string, unknown>>(response, {});
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
