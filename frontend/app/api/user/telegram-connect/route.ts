import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

export async function POST(request: Request) {
  const response = await userBackendFetch(request, "/users/me/telegram-connect", {
    method: "POST",
    body: "{}",
  });
  const payload = await safeParseJson<Record<string, unknown>>(response, {});
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
