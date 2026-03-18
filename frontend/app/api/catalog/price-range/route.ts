import { NextResponse } from "next/server";

import { serverGet } from "@/lib/api/server";

type Category = { id: string; slug: string; name: string };

type FiltersResponse = {
  price?: {
    min?: number | null;
    max?: number | null;
  };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveCategoryId = async (rawCategory: string | null): Promise<string | undefined> => {
  const normalized = String(rawCategory ?? "").trim();
  if (!normalized) return undefined;
  if (UUID_PATTERN.test(normalized)) return normalized;

  try {
    const categories = await serverGet<Category[]>("/categories");
    const matched = (categories ?? []).find((item) => {
      const slug = String(item.slug ?? "").trim().toLowerCase();
      return slug === normalized.toLowerCase();
    });
    return matched?.id;
  } catch {
    return undefined;
  }
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const categoryParam = url.searchParams.get("category");
    const categoryId = await resolveCategoryId(categoryParam);

    const params = new URLSearchParams();
    if (categoryId) params.set("category_id", categoryId);

    const payload = await serverGet<FiltersResponse>(`/filters${params.toString() ? `?${params.toString()}` : ""}`);
    const min = Math.max(0, toNumber(payload?.price?.min, 0));
    const max = Math.max(min + 1, toNumber(payload?.price?.max, 100_000_000));

    return NextResponse.json(
      {
        min,
        max,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        min: 0,
        max: 100_000_000,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
