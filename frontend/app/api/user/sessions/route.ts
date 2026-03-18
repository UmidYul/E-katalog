import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

export async function GET(request: Request) {
  const response = await userBackendFetch(request, "/auth/sessions");
  const payload = await safeParseJson<unknown[]>(response, []);
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const sessionId = String(url.searchParams.get("id") ?? "").trim();
  const revokeAll = String(url.searchParams.get("all") ?? "").trim() === "1";
  const targetPath = revokeAll ? "/auth/sessions" : sessionId ? `/auth/sessions/${sessionId}` : "";

  if (!targetPath) {
    return NextResponse.json({ error: "session_id_required" }, { status: 400 });
  }

  const response = await userBackendFetch(request, targetPath, { method: "DELETE" });
  const payload = await safeParseJson<Record<string, unknown>>(response, {});
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
