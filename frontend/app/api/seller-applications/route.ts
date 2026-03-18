import { NextResponse } from "next/server";

import { env } from "@/config/env";

type SubmissionMethod = "api" | "xml" | "excel" | "other";
type ProductCountRange = "lt100" | "100_1000" | "1000_10000" | "10000_plus";
type LegalType = "individual" | "llc" | "other";

type SellerApplicationPayload = {
  shop_name?: string;
  contact_person?: string;
  legal_type?: LegalType;
  inn?: string;
  legal_address?: string;
  actual_address?: string | null;
  contact_phone?: string;
  contact_email?: string;
  website_url?: string | null;
  product_categories?: string[];
  accepts_terms?: boolean;
  submission_method?: SubmissionMethod;
  estimated_product_count_range?: ProductCountRange;
  notes?: string | null;
};

type SellerRouteResponse = {
  ok: boolean;
  mode?: "created" | "already_applied";
  applicationId?: string;
  status?: "pending" | "review" | "approved" | "rejected";
  reviewNote?: string | null;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UZ_PHONE_REGEX = /^\+998\d{9}$/;
const STIR_REGEX = /^\d{9}$/;
const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as SellerApplicationPayload;

  const normalized = {
    shop_name: String(payload.shop_name ?? "").trim(),
    contact_person: String(payload.contact_person ?? "").trim(),
    legal_type: (payload.legal_type ?? "llc") as LegalType,
    inn: String(payload.inn ?? "").trim(),
    legal_address: String(payload.legal_address ?? "").trim(),
    actual_address: String(payload.actual_address ?? "").trim() || null,
    contact_phone: String(payload.contact_phone ?? "").trim(),
    contact_email: String(payload.contact_email ?? "").trim().toLowerCase(),
    website_url: String(payload.website_url ?? "").trim() || null,
    product_categories: Array.isArray(payload.product_categories)
      ? payload.product_categories.map((item) => String(item).trim()).filter(Boolean)
      : [],
    accepts_terms: Boolean(payload.accepts_terms),
    submission_method: (payload.submission_method ?? "api") as SubmissionMethod,
    estimated_product_count_range: (payload.estimated_product_count_range ?? "100_1000") as ProductCountRange,
    notes: String(payload.notes ?? "").trim() || null,
  };

  const fieldErrors: Record<string, string> = {};
  if (normalized.shop_name.length < 2) fieldErrors.shop_name = "shop_name_too_short";
  if (normalized.contact_person.length < 2) fieldErrors.contact_person = "contact_person_too_short";
  if (!STIR_REGEX.test(normalized.inn)) fieldErrors.inn = "inn_must_be_9_digits";
  if (!normalized.legal_address) fieldErrors.legal_address = "legal_address_required";
  if (!UZ_PHONE_REGEX.test(normalized.contact_phone)) fieldErrors.contact_phone = "invalid_uz_phone";
  if (!EMAIL_REGEX.test(normalized.contact_email)) fieldErrors.contact_email = "invalid_email";
  if (normalized.website_url && !URL_REGEX.test(normalized.website_url)) fieldErrors.website_url = "invalid_website_url";
  if (!normalized.product_categories.length) fieldErrors.product_categories = "product_categories_required";
  if (!normalized.accepts_terms) fieldErrors.accepts_terms = "accepts_terms_required";

  if (Object.keys(fieldErrors).length) {
    return NextResponse.json(
      {
        ok: false,
        message: "Майдонларни текширинг ва қайта юборинг.",
        fieldErrors,
      } satisfies SellerRouteResponse,
      { status: 422 },
    );
  }

  try {
    const response = await fetch(`${env.apiInternalOrigin}${env.apiPrefix}/seller-applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify(normalized),
      cache: "no-store",
    });

    const backendPayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: String(backendPayload.message ?? "Ариза юборилмади."),
          fieldErrors: (backendPayload.field_errors as Record<string, string>) ?? undefined,
        } satisfies SellerRouteResponse,
        { status: response.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        mode: String(backendPayload.mode ?? "created") === "already_applied" ? "already_applied" : "created",
        applicationId: String(backendPayload.application_id ?? backendPayload.id ?? ""),
        status: String(backendPayload.status ?? "pending") as SellerRouteResponse["status"],
        reviewNote: (backendPayload.review_note as string | null | undefined) ?? null,
        message: String(backendPayload.message ?? "Ариза қабул қилинди."),
      } satisfies SellerRouteResponse,
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Серверга уланишда хатолик. Илтимос, қайта уриниб кўринг.",
      } satisfies SellerRouteResponse,
      { status: 500 },
    );
  }
}
