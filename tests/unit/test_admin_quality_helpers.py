from datetime import UTC, datetime

from services.api.app.api.v1.routers.admin import _serialize_quality_no_offer_row


def test_serialize_quality_no_offer_row_fields() -> None:
    now = datetime(2026, 2, 24, 10, 30, tzinfo=UTC)
    row = {
        "id": "00000000-0000-0000-0000-000000000001",
        "normalized_title": "Apple iPhone 17 Pro Max 12/512GB eSIM",
        "main_image": "https://example.com/image.jpg",
        "is_active": True,
        "valid_store_count": 0,
        "store_count": 2,
        "total_offers": 4,
        "last_offer_seen_at": now,
        "last_valid_offer_seen_at": None,
        "updated_at": now,
        "brand_id": "00000000-0000-0000-0000-000000000002",
        "brand_name": "Apple",
        "category_id": "00000000-0000-0000-0000-000000000003",
        "category_name": "Смартфоны",
    }

    payload = _serialize_quality_no_offer_row(row)

    assert payload["id"] == row["id"]
    assert payload["normalized_title"] == row["normalized_title"]
    assert payload["is_active"] is True
    assert payload["valid_store_count"] == 0
    assert payload["store_count"] == 2
    assert payload["total_offers"] == 4
    assert payload["last_offer_seen_at"] == now.isoformat()
    assert payload["last_valid_offer_seen_at"] is None
    assert payload["updated_at"] == now.isoformat()
    assert payload["brand"] == {"id": row["brand_id"], "name": "Apple"}
    assert payload["category"] == {"id": row["category_id"], "name": "Смартфоны"}
