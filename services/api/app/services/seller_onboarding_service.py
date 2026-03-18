from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any

from fastapi import Request, Response

from shared.utils.time import UTC


logger = logging.getLogger(__name__)

SELLER_DEPRECATION_SWITCH_DATE = date(2026, 3, 15)
SELLER_DEPRECATION_SUNSET_HTTP = "Thu, 30 Apr 2026 00:00:00 GMT"


def canonicalize_partner_lead_status(status_value: str | None) -> str:
    normalized = str(status_value or "").strip().lower()
    if normalized == "submitted":
        return "pending"
    if normalized in {"review", "approved", "rejected"}:
        return normalized
    return "pending"


def internalize_seller_status(status_value: str | None) -> str:
    normalized = str(status_value or "").strip().lower()
    if normalized == "pending":
        return "submitted"
    if normalized in {"submitted", "review", "approved", "rejected"}:
        return normalized
    return "submitted"


def public_url(path: str, *, app_base_url: str) -> str:
    base = str(app_base_url or "http://localhost").strip().rstrip("/")
    normalized = str(path or "/").strip()
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return f"{base}{normalized}"


def extract_request_ip(request: Request) -> str:
    forwarded_for = str(request.headers.get("x-forwarded-for") or "").strip()
    if forwarded_for:
        candidate = forwarded_for.split(",")[0].strip()
        if candidate:
            return candidate
    real_ip = str(request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def seller_panel_urls(*, status: str, provisioning_status: str, app_base_url: str) -> tuple[str | None, str | None]:
    if str(status).strip().lower() == "approved" and str(provisioning_status).strip().lower() == "ready":
        return (
            public_url("/login?next=/dashboard/seller", app_base_url=app_base_url),
            public_url("/dashboard/seller", app_base_url=app_base_url),
        )
    return None, None


def map_seller_application_payload_to_partner_lead(payload: Any) -> dict[str, Any]:
    work_type = str(getattr(payload, "work_type", "online") or "online").strip().lower()
    contact_person = str(getattr(payload, "contact_person", "") or "").strip()
    logistics_model = "own_warehouse"
    if work_type == "both":
        logistics_model = "hybrid"
    elif work_type == "online":
        logistics_model = "dropshipping"

    raw_notes = str(getattr(payload, "notes", "") or "").strip()

    extra_context = {
        "legal_type": getattr(payload, "legal_type", "individual"),
        "contact_person": contact_person or None,
        "inn": str(getattr(payload, "inn", "") or "").strip(),
        "legal_address": str(getattr(payload, "legal_address", "") or "").strip(),
        "actual_address": str(getattr(payload, "actual_address", "") or "").strip() or None,
        "has_website": bool(getattr(payload, "has_website", False)),
        "website_url": str(getattr(payload, "website_url", "") or "").strip() or None,
        "work_type": work_type,
        "delivery_available": bool(getattr(payload, "delivery_available", False)),
        "pickup_available": bool(getattr(payload, "pickup_available", False)),
        "product_categories": list(getattr(payload, "product_categories", []) or []),
        "documents": list(getattr(payload, "documents", []) or []),
        "submission_method": str(getattr(payload, "submission_method", "") or "").strip() or None,
        "estimated_product_count_range": str(getattr(payload, "estimated_product_count_range", "") or "").strip() or None,
        "notes": raw_notes or None,
    }

    return {
        "company_name": str(getattr(payload, "shop_name", "") or "").strip(),
        "legal_name": str(getattr(payload, "legal_type", "individual") or "individual").strip().lower(),
        "brand_name": None,
        "tax_id": str(getattr(payload, "inn", "") or "").strip(),
        "website_url": str(getattr(payload, "website_url", "") or "").strip() or None,
        "contact_name": contact_person or str(getattr(payload, "shop_name", "") or "").strip(),
        "contact_role": "owner",
        "email": str(getattr(payload, "contact_email", "") or "").strip().lower(),
        "phone": str(getattr(payload, "contact_phone", "") or "").strip(),
        "telegram": None,
        "country_code": "UZ",
        "city": None,
        "categories": list(getattr(payload, "product_categories", []) or []),
        "monthly_orders": None,
        "avg_order_value": None,
        "feed_url": None,
        "logistics_model": logistics_model,
        "warehouses_count": None,
        "marketplaces": [],
        "returns_policy": None,
        "goals": None,
        "notes": json.dumps(extra_context, ensure_ascii=False),
        "accepts_terms": bool(getattr(payload, "accepts_terms", False)),
    }


def set_legacy_b2b_seller_deprecation_headers(response: Response, *, successor_path: str) -> None:
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = SELLER_DEPRECATION_SUNSET_HTTP
    response.headers["Link"] = f'<{successor_path}>; rel="successor-version"'


def maybe_log_legacy_b2b_seller_warning(*, endpoint_name: str) -> None:
    if datetime.now(UTC).date() < SELLER_DEPRECATION_SWITCH_DATE:
        return
    logger.warning("Deprecated B2B seller endpoint used: %s", endpoint_name)

