import { NextResponse } from "next/server";

import { env } from "@/config/env";

type ContactPayload = {
  name?: string;
  contact?: string;
  subject?: "general" | "technical" | "partnership" | "other";
  message?: string;
  website?: string;
};

const VALID_SUBJECTS = new Set(["general", "technical", "partnership", "other"]);

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as ContactPayload;
  const name = String(payload.name ?? "").trim();
  const contact = String(payload.contact ?? "").trim();
  const subject = String(payload.subject ?? "general").trim().toLowerCase();
  const message = String(payload.message ?? "").trim();
  const website = String(payload.website ?? "").trim();

  if (!name || !contact || !message) {
    return NextResponse.json(
      { ok: false, message: "Мажбурий майдонларни тўлдиринг." },
      { status: 422 },
    );
  }

  if (website) {
    return NextResponse.json(
      {
        ok: true,
        message: "Мурожаатингиз қабул қилинди. Жавобни тез орада юборишга ҳаракат қиламиз.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}/contact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        name,
        contact,
        subject: VALID_SUBJECTS.has(subject) ? subject : "general",
        message,
      }),
      cache: "no-store",
    });

    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: String(
            (responsePayload as { message?: string }).message ??
              "Хабар юборишда хатолик юз берди. Илтимос, қайта уриниб кўринг.",
          ),
        },
        { status: response.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        message: String(
          (responsePayload as { message?: string }).message ??
            "Мурожаатингиз қабул қилинди. Жавобни тез орада юборишга ҳаракат қиламиз.",
        ),
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: "Хабар юборишда хатолик юз берди. Илтимос, қайта уриниб кўринг." },
      { status: 500 },
    );
  }
}
