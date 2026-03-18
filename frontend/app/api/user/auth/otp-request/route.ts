import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

type RequestPayload = {
  contact?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;
  const contact = String(payload.contact ?? "").trim();
  if (!contact) {
    return NextResponse.json({ error: "contact_required" }, { status: 400 });
  }

  const response = await userBackendFetch(request, "/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ contact }),
  });
  const body = await safeParseJson<Record<string, unknown>>(response, {});
  return NextResponse.json(body, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
