import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

type DeletePayload = {
  confirmation?: string;
};

export async function DELETE(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as DeletePayload;
  const confirmation = String(payload.confirmation ?? "").trim();
  if (!confirmation) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  const response = await userBackendFetch(request, "/users/me/account", {
    method: "DELETE",
    body: JSON.stringify({ confirmation }),
  });

  if (!response.ok) {
    const failedPayload = await safeParseJson<Record<string, unknown>>(response, {});
    return NextResponse.json(failedPayload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const logoutResponse = await userBackendFetch(request, "/auth/logout", { method: "POST", body: "{}" });
  const successPayload = await safeParseJson<Record<string, unknown>>(response, { ok: true });
  const setCookie = logoutResponse.headers.get("set-cookie");
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (setCookie) headers.set("set-cookie", setCookie);

  return NextResponse.json(successPayload, {
    status: 200,
    headers,
  });
}
