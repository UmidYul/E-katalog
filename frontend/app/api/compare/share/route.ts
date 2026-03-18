import { createHash } from "crypto";
import { NextResponse } from "next/server";

const MAX_COMPARE_ITEMS = 4;

const parseIds = (value: string | null) => {
  if (!value) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= MAX_COMPARE_ITEMS) break;
  }
  return result;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = parseIds(url.searchParams.get("ids"));
  if (!ids.length) {
    return NextResponse.json({ shareId: null, url: "/compare" }, { headers: { "Cache-Control": "no-store" } });
  }

  const hash = createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 12);
  const query = ids.join(",");

  return NextResponse.json(
    {
      shareId: hash,
      url: `/compare?ids=${query}`,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

