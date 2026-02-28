from __future__ import annotations

from pathlib import Path
import sys

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.api.v1.routers.admin_sellers import AdminSellerProductModerationPatchIn
from app.api.v1.routers.seller_products import SELLER_MUTABLE_PRODUCT_STATUSES
from app.schemas.seller import SellerProductPatchIn, SellerShopPatchIn


def test_seller_product_patch_status_allows_only_mutable_statuses() -> None:
    SellerProductPatchIn(status="draft")
    SellerProductPatchIn(status="pending_moderation")
    SellerProductPatchIn(status="archived")

    with pytest.raises(ValidationError):
        SellerProductPatchIn(status="active")
    with pytest.raises(ValidationError):
        SellerProductPatchIn(status="rejected")


def test_seller_mutable_status_set_excludes_admin_only_statuses() -> None:
    assert SELLER_MUTABLE_PRODUCT_STATUSES == {"draft", "pending_moderation", "archived"}


def test_seller_shop_patch_schema_does_not_accept_status_field() -> None:
    assert "status" not in SellerShopPatchIn.model_fields


def test_admin_product_moderation_patch_accepts_admin_statuses() -> None:
    AdminSellerProductModerationPatchIn(status="active")
    AdminSellerProductModerationPatchIn(status="rejected", moderation_comment="Требуется доработка")
    AdminSellerProductModerationPatchIn(status="archived")


def test_seller_shop_update_sql_does_not_update_shop_status() -> None:
    source = (ROOT / "services" / "api" / "app" / "api" / "v1" / "routers" / "seller_dashboard.py").read_text(encoding="utf-8").lower()
    start = source.find("update seller_shops")
    assert start >= 0
    end = source.find("where owner_user_uuid", start)
    assert end > start
    update_sql = source[start:end]
    assert "status =" not in update_sql
