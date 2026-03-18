import { NextResponse } from "next/server";

import { serverGet } from "@/lib/api/server";

type LastSyncPayload = {
  timestamp: string | null;
};

export async function GET() {
  try {
    const payload = await serverGet<LastSyncPayload>("/last-sync");
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ timestamp: null } satisfies LastSyncPayload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}

