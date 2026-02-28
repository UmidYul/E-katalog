from __future__ import annotations

from pathlib import Path
import sys

from fastapi import Response

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.services.seller_onboarding_service import (
    SELLER_DEPRECATION_SUNSET_HTTP,
    set_legacy_b2b_seller_deprecation_headers,
)


def test_set_legacy_b2b_seller_deprecation_headers_for_create_route() -> None:
    response = Response()
    set_legacy_b2b_seller_deprecation_headers(response, successor_path="/api/v1/applications/seller")
    assert response.headers.get("Deprecation") == "true"
    assert response.headers.get("Sunset") == SELLER_DEPRECATION_SUNSET_HTTP
    assert response.headers.get("Link") == '</api/v1/applications/seller>; rel="successor-version"'


def test_set_legacy_b2b_seller_deprecation_headers_for_status_route() -> None:
    response = Response()
    set_legacy_b2b_seller_deprecation_headers(response, successor_path="/api/v1/applications/seller/status")
    assert response.headers.get("Deprecation") == "true"
    assert response.headers.get("Sunset") == SELLER_DEPRECATION_SUNSET_HTTP
    assert response.headers.get("Link") == '</api/v1/applications/seller/status>; rel="successor-version"'


def test_b2b_partner_routes_apply_deprecation_helper() -> None:
    source = (ROOT / "services" / "api" / "app" / "api" / "v1" / "routers" / "b2b_partners.py").read_text(encoding="utf-8")
    assert 'set_legacy_b2b_seller_deprecation_headers(response, successor_path="/api/v1/applications/seller")' in source
    assert 'set_legacy_b2b_seller_deprecation_headers(response, successor_path="/api/v1/applications/seller/status")' in source
