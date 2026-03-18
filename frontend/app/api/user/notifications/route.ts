import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

export async function GET(request: Request) {
  const response = await userBackendFetch(request, "/users/me/notification-preferences");
  const payload = await safeParseJson<Record<string, unknown>>(response, {});
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request: Request) {
  const body = await request.text();
  const response = await userBackendFetch(request, "/users/me/notification-preferences", {
    method: "PATCH",
    body,
  });
  const payload = await safeParseJson<Record<string, unknown>>(response, {});
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
