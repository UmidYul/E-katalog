import { NextResponse } from "next/server";

import { safeParseJson, userBackendFetch } from "@/app/api/user/_helpers";

type VerifyPayload = {
  contact?: string;
  code?: string;
  rememberMe?: boolean;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as VerifyPayload;
  const contact = String(payload.contact ?? "").trim();
  const code = String(payload.code ?? "").trim();
  if (!contact || !code) {
    return NextResponse.json({ error: "contact_and_code_required" }, { status: 400 });
  }

  const response = await userBackendFetch(request, "/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({
      contact,
      code,
      remember_me: payload.rememberMe !== false,
    }),
  });

  const body = await safeParseJson<Record<string, unknown>>(response, {});
  const headers = new Headers({ "Cache-Control": "no-store" });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);

  return NextResponse.json(body, {
    status: response.status,
    headers,
  });
}
